import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  dragOverlayOccurrence,
  dragOverlayRow,
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree, setDropIndentLevelForRows } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function simpleSourceWorkspace(anchorRow: string): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      anchorRow,
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
      "- C <!-- id:c -->",
    ].join("\n"),
  });
}

test.each(variants)(
  "dropping after an anchored own row inside an embed [%s]",
  async (variant) => {
    const workspacePath = simpleSourceWorkspace(
      '  - Own anchor <!-- id:own front="true" -->'
    );
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "C");
    dragOverlayRow("C", "Own anchor");
    const expected = `
Note
  Source
    Own anchor
    ${markerForVariant(variant)}C
    A
    B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)("dropping after a rewording [%s]", async (variant) => {
  const workspacePath = simpleSourceWorkspace(
    '  - Reader A ~~[A](#a)~~ <!-- id:reader-a embed="true" front="true" -->'
  );
  await expandOverlayWorkspace(workspacePath, "note.md");
  await materializeOverlayRow(variant, "C");
  dragOverlayRow("C", "Reader A");
  const expected = `
Note
  Source
    Reader A
    ${markerForVariant(variant)}C
    B
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "dropping after a placement whose ID differs from its target [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Originals <!-- id:originals -->",
        "  - A <!-- id:a -->",
        '- [A](#a) <!-- id:placement-a embed="true" -->',
        "- C <!-- id:c -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "C");
    dragOverlayOccurrence("C", 0, "A", 1);
    const expected = `
Note
  Source
    Originals
      A
        [I] Source ↩
    A
    ${markerForVariant(variant)}C
  `;
    await expectTree(expected, { showGutter: true });
    await waitFor(() => {
      expect(readOverlayFile(workspacePath, "note.md")).toMatch(
        /\[C\]\(#c\)[^\n]*after="placement-a"/u
      );
    });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

function recursiveWorkspace(repeated: boolean): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Outer](#outer) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "outer.md": [
      "# Outer <!-- id:outer -->",
      "",
      '- [Inner](#inner) <!-- id:inner-one embed="true" -->',
      ...(repeated
        ? ['- [Inner](#inner) <!-- id:inner-two embed="true" -->']
        : []),
      "- C <!-- id:c -->",
    ].join("\n"),
    "inner.md": [
      "# Inner <!-- id:inner -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
    ].join("\n"),
  });
}

test.each(variants)(
  "dropping after one exact recursive occurrence [%s]",
  async (variant) => {
    const workspacePath = recursiveWorkspace(false);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "C");
    dragOverlayRow("C", "A");
    const expected = `
Note
  Outer
    Inner
      A
      ${markerForVariant(variant)}C
      B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "dropping after an ambiguous repeated recursive occurrence [%s]",
  async (variant) => {
    const workspacePath = recursiveWorkspace(true);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "C");
    dragOverlayOccurrence("C", 0, "A", 0);
    const expected = `
Note
  Outer
    Inner
      A
      ${markerForVariant(variant)}C
      B
    Inner
      A
      B
      [I] Outer ↩
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an inner recursive placement without changing the outer placement [%s]",
  async (variant) => {
    const workspacePath = recursiveWorkspace(false);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A");
    dragOverlayRow("A", "B");
    const expected = `
Note
  Outer
    Inner
      B
      ${markerForVariant(variant)}A
    C
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an outer recursive placement without changing the inner placement [%s]",
  async (variant) => {
    const workspacePath = recursiveWorkspace(false);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Inner");
    dragOverlayRow("Inner", "C");
    const expected = `
Note
  Outer
    C
    ${markerForVariant(variant)}Inner
      A
      B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

function duplicateWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed-one embed="true" -->',
      '- [Source](#source) <!-- id:embed-two embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
      "- C <!-- id:c -->",
    ].join("\n"),
  });
}

async function materializeOccurrence(
  variant: string,
  index: number
): Promise<void> {
  if (variant !== "materialized-first") {
    return;
  }
  await userEvent.click(screen.getAllByRole("treeitem", { name: "A" })[index]);
  await userEvent.keyboard("!");
}

test.each(variants)(
  "materializing then moving one occurrence in duplicate embeds [%s]",
  async (variant) => {
    const workspacePath = duplicateWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, 0);
    dragOverlayOccurrence("A", 0, "C", 0);
    const expected = `
Note
  Source
    B
    C
    ${markerForVariant(variant)}A
    [I] Note ↩
  Source
    A
    B
    C
    [I] Note ↩
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "positioning the same target independently in two duplicate embeds [%s]",
  async (variant) => {
    const workspacePath = duplicateWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, 0);
    await materializeOccurrence(variant, 1);
    dragOverlayOccurrence("A", 0, "C", 0);
    await waitFor(() => {
      expect(
        readOverlayFile(workspacePath, "note.md").match(/after="c"/gu)
      ).toHaveLength(1);
    });
    dragOverlayOccurrence("A", 1, "C", 1);
    const expected = `
Note
  Source
    B
    C
    ${markerForVariant(variant)}A
    [I] Note ↩
  Source
    B
    C
    ${markerForVariant(variant)}A
    [I] Note ↩
  `;
    await expectTree(expected, { showGutter: true });
    await waitFor(() => {
      expect(
        readOverlayFile(workspacePath, "note.md").match(/\(#a\)/gu)
      ).toHaveLength(2);
    });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving one occurrence out of duplicate embeds leaves the sibling embed whole [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed-one embed="true" -->',
        '- [Source](#source) <!-- id:embed-two embed="true" -->',
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
    await materializeOccurrence(variant, 0);
    const sourceRow = screen.getAllByRole("treeitem", { name: "A" })[0];
    const targetRow = screen.getByRole("treeitem", { name: "Basket" });
    fireEvent.dragStart(sourceRow);
    setDropIndentLevelForRows(sourceRow, targetRow, 3);
    fireEvent.drop(targetRow);
    const expected = `
Note
  Source
    B
    C
    [I] Note ↩
  Source
    A
    B
    C
    [I] Note ↩
  Basket
    ${markerForVariant(variant)}A
  `;
    await expectTree(expected, { showGutter: true });
    await waitFor(() => {
      expect(readOverlayFile(workspacePath, "note.md")).toMatch(
        /from="embed-one"/u
      );
    });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test("a hand-written occurrence record consumes only its recorded embed", async () => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed-one embed="true" -->',
      '- [Source](#source) <!-- id:embed-two embed="true" -->',
      '- [A](#a) <!-- id:o3 embed="true" from="embed-one" -->',
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
  const expected = `
Note
  Source
    B
    C
    [I] Note ↩
  Source
    A
    B
    C
    [I] Note ↩
  A
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "moving a cycle-boundary row without consuming another occurrence [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [A](#a) <!-- id:embed embed="true" -->',
      ].join("\n"),
      "a.md": [
        "# A <!-- id:a -->",
        "",
        '- [B](#b) <!-- id:b-view embed="true" -->',
      ].join("\n"),
      "b.md": [
        "# B <!-- id:b -->",
        "",
        '- [A](#a) <!-- id:a-cycle embed="true" -->',
        "- B sibling <!-- id:bs -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    if (variant === "materialized-first") {
      await userEvent.click(screen.getAllByRole("treeitem", { name: "A" })[1]);
      await userEvent.keyboard("!");
    }
    dragOverlayOccurrence("A", 1, "B sibling", 0);
    const expected = `
Note
  A
    B
      B sibling
      ${markerForVariant(variant)}A
  `;
    await expectTree(expected, { showGutter: true });
    expect(screen.getAllByRole("treeitem", { name: "A" })).toHaveLength(2);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
