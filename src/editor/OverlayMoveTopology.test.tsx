import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { clickRow, modClick } from "./Multiselect.testUtils";
import {
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  openNodeInFullscreen,
  setDropIndentLevel,
} from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function standardWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Parent A <!-- id:pa -->",
      "  - Moved <!-- id:moved -->",
      "    - Child <!-- id:child -->",
      "- Empty <!-- id:empty -->",
      "- Parent B <!-- id:pb -->",
      "  - B One <!-- id:b1 -->",
      "  - B Two <!-- id:b2 -->",
    ].join("\n"),
  });
}

test.each(variants)(
  "moving into an empty projected parent [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Moved");
    reparentOverlayRow("Moved", "Empty", 4);
    const expected = `
Note
  Source
    Parent A
    Empty
      ${markerForVariant(variant)}Moved
        Child
    Parent B
      B One
      B Two
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving to the tail of a different projected parent [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Moved");
    reparentOverlayRow("Moved", "B Two", 4);
    const expected = `
Note
  Source
    Parent A
    Empty
    Parent B
      B One
      B Two
      ${markerForVariant(variant)}Moved
        Child
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving into a collapsed projected parent [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Moved");
    await userEvent.click(screen.getByLabelText("collapse Parent B"));
    reparentOverlayRow("Moved", "Parent B", 4);
    const expected = `
Note
  Source
    Parent A
    Empty
    Parent B
      ${markerForVariant(variant)}Moved
        Child
      B One
      B Two
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving across panes within the same document [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Moved");
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Note");
    await openNodeInFullscreen(1, "Note");
    const paneRoot = getPane(1).getByRole("treeitem", { name: "Note" });
    await userEvent.click(paneRoot);
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
    fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Moved" }));
    fireEvent.drop(getPane(1).getByRole("treeitem", { name: "B Two" }));
    await userEvent.click(getPane(0).getByLabelText("Close pane"));
    const expected = `
Note
  Source
    Parent A
    Empty
    Parent B
      B One
      B Two
      ${markerForVariant(variant)}Moved
        Child
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected row under an own row outside the embed [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        "- My own row <!-- id:own -->",
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- A <!-- id:a -->",
        "- B <!-- id:b -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A");
    reparentOverlayRow("A", "My own row", 3);
    const expected = `
Note
  Source
    B
  My own row
    ${markerForVariant(variant)}A
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected row onto an own comment inside the embed [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        "  - My comment <!-- id:comment -->",
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- A <!-- id:a -->",
        "- B <!-- id:b -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A");
    reparentOverlayRow("A", "My comment", 4);
    const expected = `
Note
  Source
    B
    My comment
      ${markerForVariant(variant)}A
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected row from one embed into another [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Alpha](#alpha) <!-- id:embed-a embed="true" -->',
        '- [Beta](#beta) <!-- id:embed-b embed="true" -->',
      ].join("\n"),
      "alpha.md": [
        "# Alpha <!-- id:alpha -->",
        "",
        "- A one <!-- id:a1 -->",
        "- A two <!-- id:a2 -->",
      ].join("\n"),
      "beta.md": [
        "# Beta <!-- id:beta -->",
        "",
        "- B one <!-- id:b1 -->",
        "- B two <!-- id:b2 -->",
      ].join("\n"),
    });
    const alphaBefore = readOverlayFile(workspacePath, "alpha.md");
    const betaBefore = readOverlayFile(workspacePath, "beta.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A one");
    dragOverlayRow("A one", "B one");
    const expected = `
Note
  Alpha
    A two
  Beta
    B one
    ${markerForVariant(variant)}A one
    B two
  `;
    await expectTree(expected, { showGutter: true });
    await waitFor(() => {
      expect(readOverlayFile(workspacePath, "note.md")).toMatch(
        /\[A one\]\(#a1\) <!-- id:\S+ embed="true" from="embed-a" after="b1" before="b2" parent="beta" -->/u
      );
      expect(readOverlayFile(workspacePath, "alpha.md")).toContain(alphaBefore);
      expect(readOverlayFile(workspacePath, "beta.md")).toContain(betaBefore);
    });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test("dragging the embed row under an own row moves the whole projection", async () => {
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
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  reparentOverlayRow("Source", "Basket", 3);
  const expected = `
Note
  Basket
    Source
      A
      B
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test("multiselecting an embed row and its projected child moves only the embed", async () => {
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
    ].join("\n"),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  await clickRow("Source");
  modClick(screen.getByLabelText("A"), { metaKey: true });
  fireEvent.dragStart(screen.getByText("Source"));
  setDropIndentLevel("Source", "Basket", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Basket" }));
  const expected = `
Note
  Basket
    Source
      A
      B
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test("dragging a rewording out of the embed keeps one showing", async () => {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      '  - Reader words ~~[A](#a)~~ <!-- id:reword embed="true" -->',
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
  reparentOverlayRow("Reader words", "Basket", 3);
  const expected = `
Note
  Source
    B
  Basket
    Reader words
  `;
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "moving a projected parent with an untouched subtree [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Empty
    Parent B
      ${markerForVariant(variant)}Parent A
        Moved
          Child
      B One
      B Two
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected parent with a materialized descendant [%s]",
  async (variant) => {
    const workspacePath = standardWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await userEvent.click(screen.getByRole("treeitem", { name: "Child" }));
    await userEvent.keyboard("?");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Empty
    Parent B
      ${markerForVariant(variant)}Parent A
        Moved
          {?} Child
      B One
      B Two
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected parent with an own-row descendant [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        '  - [Parent A](#pa) <!-- id:pa-view embed="true" -->',
        "    - Own child <!-- id:own -->",
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Parent A <!-- id:pa -->",
        "- Parent B <!-- id:pb -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Parent B
      ${markerForVariant(variant)}Parent A
        Own child
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected parent with a reworded descendant [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        '  - [Parent A](#pa) <!-- id:pa-view embed="true" -->',
        '    - Reader child ~~[Child](#child)~~ <!-- id:child-view embed="true" -->',
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Parent A <!-- id:pa -->",
        "  - Child <!-- id:child -->",
        "- Parent B <!-- id:pb -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Parent B
      ${markerForVariant(variant)}Parent A
        Reader child
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected parent with a dismissed hidden descendant [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        '  - [Parent A](#pa) <!-- id:pa-view embed="true" -->',
        '    - (x) [Child](#child) <!-- id:child-view embed="true" -->',
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Parent A <!-- id:pa -->",
        "  - Child <!-- id:child -->",
        "- Parent B <!-- id:pb -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Parent B
      ${markerForVariant(variant)}Parent A
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a projected parent with a mixed deep diff subtree [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Source](#source) <!-- id:embed embed="true" -->',
        '  - [Parent A](#pa) <!-- id:pa-view embed="true" -->',
        '    - (!) [Child A](#ca) <!-- id:ca-view embed="true" -->',
        "      - Own grandchild <!-- id:own -->",
        '    - Reader B ~~[Child B](#cb)~~ <!-- id:cb-view embed="true" -->',
        '    - (x) [Child C](#cc) <!-- id:cc-view embed="true" -->',
      ].join("\n"),
      "source.md": [
        "# Source <!-- id:source -->",
        "",
        "- Parent A <!-- id:pa -->",
        "  - Child A <!-- id:ca -->",
        "  - Child B <!-- id:cb -->",
        "  - Child C <!-- id:cc -->",
        "- Parent B <!-- id:pb -->",
      ].join("\n"),
    });
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Parent A");
    reparentOverlayRow("Parent A", "Parent B", 4);
    const expected = `
Note
  Source
    Parent B
      ${markerForVariant(variant)}Parent A
        {!} Child A
          Own grandchild
        Reader B
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
