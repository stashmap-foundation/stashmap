import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  dragOverlayRow,
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  reparentOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function transitionWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - B <!-- id:b -->",
      "  - C <!-- id:c -->",
      "- Parent Q <!-- id:q -->",
    ].join("\n"),
  });
}

async function moveB(variant: string): Promise<string> {
  const workspacePath = transitionWorkspace();
  await expandOverlayWorkspace(workspacePath, "note.md");
  await materializeOverlayRow(variant, "B");
  reparentOverlayRow("B", "Parent Q", 4);
  await expectTree(
    `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
  `,
    { showGutter: true }
  );
  return workspacePath;
}

test.each(variants)(
  "moving out of the embed, back in, and to the front [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        "- Basket <!-- id:basket -->",
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- A <!-- id:a -->",
        "- B <!-- id:b -->",
        "- C <!-- id:c -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "B");
    reparentOverlayRow("B", "Basket", 3);
    await expectTree(
      `
Note
  Source
    A
    C
  Basket
    ${markerForVariant(variant)}B
  `,
      { showGutter: true }
    );
    await waitFor(() => {
      expect(readOverlayFile(workspacePath, "note.md")).toMatch(
        /front="true"/u
      );
    });
    dragOverlayRow("B", "A");
    await expectTree(
      `
Note
  Source
    A
    ${markerForVariant(variant)}B
    C
  Basket
  `,
      { showGutter: true }
    );
    await waitFor(() => {
      const note = readOverlayFile(workspacePath, "note.md");
      expect(note).toMatch(/after="a"/u);
      expect(note).not.toMatch(/from="/u);
    });
    reparentOverlayRow("B", "Source", 3);
    const expected = `
Note
  Source
    ${markerForVariant(variant)}B
    A
    C
  Basket
  `;
    await expectTree(expected, { showGutter: true });
    await waitFor(() => {
      expect(
        readOverlayFile(workspacePath, "note.md").match(/\(#b\)/gu)
      ).toHaveLength(1);
    });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)("moving then adding evidence [%s]", async (variant) => {
  const workspacePath = await moveB(variant);
  await userEvent.click(screen.getByRole("treeitem", { name: "B" }));
  await userEvent.keyboard("+");
  const marker = variant === "materialized-first" ? "{!+} " : "{+} ";
  const expected = `
Note
  Source
    Parent P
      A
      B
      C
    Parent Q
      ${marker}B
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "moving then adding a combined marker [%s]",
  async (variant) => {
    const workspacePath = await moveB(variant);
    if (variant === "projected") {
      await userEvent.click(screen.getByRole("treeitem", { name: "B" }));
      await userEvent.keyboard("!");
    }
    await userEvent.click(screen.getByRole("treeitem", { name: "B" }));
    await userEvent.keyboard("+");
    const expected = `
Note
  Source
    Parent P
      A
      B
      C
    Parent Q
      {!+} B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving then dismissing and restoring [%s]",
  async (variant) => {
    const workspacePath = await moveB(variant);
    await userEvent.click(screen.getByRole("treeitem", { name: "B" }));
    await userEvent.keyboard("x");
    expect(screen.queryByRole("treeitem", { name: "B" })).toBeNull();
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await userEvent.click(screen.getByRole("treeitem", { name: "B" }));
    await userEvent.keyboard("?");
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      {?} B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)("moving then rewording twice [%s]", async (variant) => {
  const workspacePath = await moveB(variant);
  const editor = screen.getByRole("textbox", { name: "edit B" });
  await userEvent.clear(editor);
  await userEvent.type(editor, "First wording{Escape}");
  const second = screen.getByRole("textbox", { name: "edit First wording" });
  await userEvent.clear(second);
  await userEvent.type(second, "Final wording{Escape}");
  const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}Final wording
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)("moving then adding an own child [%s]", async (variant) => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      "- Own child <!-- id:own -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - B <!-- id:b -->",
      "  - C <!-- id:c -->",
      "- Parent Q <!-- id:q -->",
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  await materializeOverlayRow(variant, "B");
  reparentOverlayRow("B", "Parent Q", 4);
  await expectTree(
    `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
  Own child
  `,
    { showGutter: true }
  );
  reparentOverlayRow("Own child", "B", 5);
  const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
        Own child
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "moving then adding an embedded child [%s]",
  async (variant) => {
    const workspacePath = await moveB(variant);
    reparentOverlayRow("C", "B", 5);
    const expected = `
Note
  Source
    Parent P
      A
    Parent Q
      ${markerForVariant(variant)}B
        C
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

function ancestorWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Parent P <!-- id:p -->",
      "  - Ancestor <!-- id:ancestor -->",
      "    - Child One <!-- id:child-one -->",
      "    - Child Two <!-- id:child-two -->",
      "- Parent Q <!-- id:q -->",
    ].join("\n"),
  });
}

test.each(variants)(
  "moving a descendant then moving its ancestor [%s]",
  async (variant) => {
    const workspacePath = ancestorWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Ancestor");
    dragOverlayRow("Child One", "Child Two");
    await expectTree(
      `
Note
  Source
    Parent P
      ${markerForVariant(variant)}Ancestor
        Child Two
        Child One
    Parent Q
  `,
      { showGutter: true }
    );
    reparentOverlayRow("Ancestor", "Parent Q", 4);
    const expected = `
Note
  Source
    Parent P
    Parent Q
      ${markerForVariant(variant)}Ancestor
        Child Two
        Child One
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an ancestor then materializing its descendant [%s]",
  async (variant) => {
    const workspacePath = ancestorWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Ancestor");
    reparentOverlayRow("Ancestor", "Parent Q", 4);
    await userEvent.click(screen.getByRole("treeitem", { name: "Child One" }));
    await userEvent.keyboard("?");
    const expected = `
Note
  Source
    Parent P
    Parent Q
      ${markerForVariant(variant)}Ancestor
        {?} Child One
        Child Two
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
