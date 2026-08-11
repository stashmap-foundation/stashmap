import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { clickRow, modClick } from "./Multiselect.testUtils";
import {
  expectTree,
  setDropIndentLevel,
  setDropIndentLevelForRows,
} from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function workspace(rows: string[]): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "source.md": ["# Source <!-- id:source -->", "", ...rows].join("\n"),
  });
}

async function selectWith(name: string, other: string): Promise<void> {
  await clickRow(name);
  modClick(await screen.findByLabelText(other), { metaKey: true });
}

function dropSelected(source: string, destination: string): void {
  fireEvent.dragStart(screen.getByText(source));
  setDropIndentLevel(source, destination, 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: destination }));
}

async function expectSourceUnchanged(
  workspacePath: string,
  sourceBefore: string
): Promise<void> {
  await waitFor(() =>
    expect(readOverlayFile(workspacePath, "source.md")).toContain(sourceBefore)
  );
}

test.each(variants)(
  "moving a selected anchor without its dependent [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - Anchor <!-- id:anchor -->",
      "  - (+) Dependent <!-- id:dependent -->",
      "  - Other <!-- id:other -->",
      "- Parent Q <!-- id:q -->",
    ]);
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await selectWith("Anchor", "Other");
    dropSelected("Anchor", "Parent Q");
    const expected = `
Note
  Source
    Parent P
      {+} Dependent
    Parent Q
      ${markerForVariant(variant)}Anchor
      Other
  `;
    await expectTree(expected, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a selected anchor together with its dependent [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - Anchor <!-- id:anchor -->",
      "  - (+) Dependent <!-- id:dependent -->",
      "  - Other <!-- id:other -->",
      "- Parent Q <!-- id:q -->",
    ]);
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await clickRow("Anchor");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    dropSelected("Anchor", "Parent Q");
    const expected = `
Note
  Source
    Parent P
      Other
    Parent Q
      ${markerForVariant(variant)}Anchor
      {+} Dependent
  `;
    await expectTree(expected, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a selected prefix or suffix of an anchor chain [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - Anchor <!-- id:anchor -->",
      "  - (+) Middle <!-- id:middle -->",
      "  - (+) Tail <!-- id:tail -->",
      "  - Survivor <!-- id:survivor -->",
      "- Parent Q <!-- id:q -->",
    ]);
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await clickRow("Anchor");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    dropSelected("Anchor", "Parent Q");
    const expected = `
Note
  Source
    Parent P
      {+} Tail
      Survivor
    Parent Q
      ${markerForVariant(variant)}Anchor
      {+} Middle
  `;
    await expectTree(expected, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving selected projected rows under an own row outside the embed [%s]",
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
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A");
    await selectWith("A", "C");
    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "Basket", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Basket" }));
    const expected = `
Note
  Source
    B
  Basket
    ${markerForVariant(variant)}A
    C
  `;
    await expectTree(expected, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test("moving a positioned comment out of the embed releases its anchor", async () => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      '  - C one <!-- id:c1 after="a" -->',
      '  - [B](#b) <!-- id:bv embed="true" -->',
      "    - C two <!-- id:c2 -->",
      "- Basket <!-- id:basket -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  await expectTree(
    `
Note
  Source
    A
    C one
    B
      C two
  Basket
  `,
    { showGutter: true }
  );
  await selectWith("C one", "C two");
  fireEvent.dragStart(screen.getByText("C one"));
  setDropIndentLevel("C one", "Basket", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Basket" }));
  const expected = `
Note
  Source
    A
    B
  Basket
    C one
    C two
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test("moving a selected comment and projected row together under an own row", async () => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      "  - C one <!-- id:c1 -->",
      "- Basket <!-- id:basket -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  await selectWith("C one", "A");
  fireEvent.dragStart(screen.getByText("C one"));
  setDropIndentLevel("C one", "Basket", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Basket" }));
  const expected = `
Note
  Source
    B
  Basket
    A
    C one
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test("moving a comment from one placement onto a projected row files it there", async () => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      '  - [B](#b) <!-- id:bv embed="true" -->',
      "    - C two <!-- id:c2 -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- A <!-- id:a -->",
      "- B <!-- id:b -->",
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  const sourceRow = screen.getByText("C two");
  const targetRow = screen.getByRole("treeitem", { name: "A" });
  fireEvent.dragStart(sourceRow);
  setDropIndentLevelForRows(sourceRow, targetRow, 4);
  fireEvent.drop(targetRow);
  const expected = `
Note
  Source
    A
      C two
    B
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "moving mixed projected, relevance, evidence, and rewording rows across repeated scopes [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed-1 embed="true" -->',
        '  - [Parent P](#p) <!-- id:p-1 embed="true" -->',
        "    - (!) [Relevant](#relevant) <!-- id:relevant-1 -->",
        "    - (+) [Evidence](#evidence) <!-- id:evidence-1 -->",
        '    - [Reworded](#reworded) <!-- id:reworded-1 rewordedFrom="Reword me" -->',
        '- [Source](#source) <!-- id:embed-2 embed="true" -->',
        '  - [Parent P](#p) <!-- id:p-2 embed="true" -->',
        "    - (!) [Relevant](#relevant) <!-- id:relevant-2 -->",
        "    - (+) [Evidence](#evidence) <!-- id:evidence-2 -->",
        '    - [Reworded](#reworded) <!-- id:reworded-2 rewordedFrom="Reword me" -->',
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Parent P <!-- id:p -->",
        "  - Projected <!-- id:projected -->",
        "  - Relevant <!-- id:relevant -->",
        "  - Evidence <!-- id:evidence -->",
        "  - Reword me <!-- id:reworded -->",
        "- Parent Q <!-- id:q -->",
      ].join("\n"),
    });
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    const projected = screen.getAllByLabelText("Projected")[0];
    await userEvent.click(projected);
    if (variant === "materialized-first") {
      await userEvent.keyboard("!");
      await expectTree(
        `
Note
  Source
    Parent P
      {!} Projected
      {!} Relevant
      {+} Evidence
      Reworded
    Parent Q
    [I] Note ↩
  Source
    Parent P
      Projected
      {!} Relevant
      {+} Evidence
      Reworded
    Parent Q
    [I] Note ↩
  `,
        { showGutter: true }
      );
    }
    await userEvent.click(screen.getAllByLabelText("Projected")[0]);
    modClick(screen.getAllByLabelText("Relevant")[0], { metaKey: true });
    modClick(screen.getAllByLabelText("Evidence")[0], { metaKey: true });
    modClick(screen.getAllByLabelText("Reworded")[0], { metaKey: true });
    const sourceRow = screen.getAllByText("Projected")[0];
    const targetRow = screen.getAllByRole("treeitem", { name: "Parent Q" })[0];
    fireEvent.dragStart(sourceRow);
    setDropIndentLevelForRows(sourceRow, targetRow, 4);
    fireEvent.drop(targetRow);
    const marker = markerForVariant(variant);
    const expected = `
Note
  Source
    Parent P
      Relevant
      Evidence
      Reword me
    Parent Q
      ${marker}Projected
      {!} Relevant
      {+} Evidence
      Reworded
    [I] Note ↩
  Source
    Parent P
      Projected
      {!} Relevant
      {+} Evidence
      Reworded
    Parent Q
    [I] Note ↩
  `;
    await expectTree(expected, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
