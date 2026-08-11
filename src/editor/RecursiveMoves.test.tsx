import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  dragOverlayRow,
  expectOverlayTreeAfterReload,
  markerForVariant,
  materializeOverlayRow,
  reparentOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import {
  awaitRecursivePlacement,
  expandRecursiveWorkspace,
  recursiveMiddle,
  recursiveSource,
  recursiveTerminal,
  writeRecursiveWorkspace,
} from "./RecursiveScenario.test";
import { clickRow, modClick } from "./Multiselect.testUtils";
import { expectTree, setDropIndentLevel } from "../utils.test";

const variants = ["projected", "materialized-first"];

async function workspace(variant: string, name: string): Promise<string> {
  const workspacePath = writeRecursiveWorkspace();
  await expandRecursiveWorkspace(workspacePath);
  await materializeOverlayRow(variant, name);
  return workspacePath;
}

afterEach(cleanup);

test.each(variants)(
  "moving a terminal row under an own row at the note level [%s]",
  async (variant) => {
    const workspacePath = writeOverlayWorkspace({
      "note.md": [
        "# Note <!-- id:note -->",
        "",
        '- [Outer](#outer) <!-- id:note-outer embed="true" -->',
        "- Basket <!-- id:basket -->",
      ].join("\n"),
      "outer.md": recursiveSource,
      "middle.md": recursiveMiddle,
      "terminal.md": recursiveTerminal,
    });
    await expandRecursiveWorkspace(workspacePath);
    await materializeOverlayRow(variant, "Beta");
    reparentOverlayRow("Beta", "Basket", 3);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
  Basket
    ${markerForVariant(variant)}Beta
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a terminal child to the front through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Gamma");
    reparentOverlayRow("Gamma", "Terminal Parent", 8);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              ${markerForVariant(variant)}Gamma
              Alpha
              Beta
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "gamma");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a terminal child to the tail through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    dragOverlayRow("Beta", "Gamma");
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
              ${markerForVariant(variant)}Beta
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "reparenting a terminal child inside its terminal source [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    reparentOverlayRow("Beta", "Terminal Destination", 8);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
              ${markerForVariant(variant)}Beta
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a terminal child across the terminal source boundary [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    reparentOverlayRow("Beta", "Middle Destination", 6);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
          ${markerForVariant(variant)}Beta
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a terminal child across two recursive source boundaries [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    reparentOverlayRow("Beta", "Outer Destination", 4);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
      ${markerForVariant(variant)}Beta
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving the terminal embed within the middle embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Terminal");
    reparentOverlayRow("Terminal", "Middle Destination", 6);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Middle After
        Middle Destination
          ${markerForVariant(variant)}Terminal
            Terminal Parent
              Alpha
              Beta
              Gamma
            Terminal Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "middle-terminal");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving the middle embed within the outer embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Middle");
    reparentOverlayRow("Middle", "Outer Destination", 4);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Outer After
    Outer Destination
      ${markerForVariant(variant)}Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Beta
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "outer-middle");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a descendant before moving its recursive ancestor [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    reparentOverlayRow("Beta", "Terminal Destination", 8);
    await expectTree(
      `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
              ${markerForVariant(variant)}Beta
          Middle After
        Middle Destination
      Outer After
    Outer Destination
      `,
      { showGutter: true }
    );
    await awaitRecursivePlacement(workspacePath, "beta");
    reparentOverlayRow("Terminal", "Middle Destination", 6);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Middle After
        Middle Destination
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
              ${markerForVariant(variant)}Beta
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a recursive anchor while leaving its dependent behind [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    dragOverlayRow("Alpha", "Beta");
    await expectTree(
      `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              ${markerForVariant(variant)}Beta
              Alpha
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
      `,
      { showGutter: true }
    );
    await awaitRecursivePlacement(workspacePath, "alpha");
    reparentOverlayRow("Beta", "Terminal Destination", 8);
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              Gamma
            Terminal Destination
              ${markerForVariant(variant)}Beta
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving selected terminal siblings through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Alpha");
    await clickRow("Alpha");
    modClick(await screen.findByLabelText("Beta"), { metaKey: true });
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Alpha" }));
    setDropIndentLevel("Alpha", "Terminal Destination", 8);
    fireEvent.drop(
      screen.getByRole("treeitem", { name: "Terminal Destination" })
    );
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Gamma
            Terminal Destination
              ${markerForVariant(variant)}Alpha
              Beta
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectTree(expected, { showGutter: true });
    await awaitRecursivePlacement(workspacePath, "beta");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
