import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  reparentOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import {
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  openNodeInFullscreen,
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
