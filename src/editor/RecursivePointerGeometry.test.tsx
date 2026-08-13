import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import {
  expectOverlayTreeAfterReload,
  markerForVariant,
  materializeOverlayRow,
} from "./OverlayScenario.test";
import { clearDropIndent } from "./DroppableContainer";
import {
  awaitRecursivePlacement,
  expandRecursiveWorkspace,
  writeRecursiveWorkspace,
} from "./RecursiveScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(() => {
  clearDropIndent();
  cleanup();
});

async function settleHover(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 20);
    });
  });
}

function dragOver(row: HTMLElement, clientX: number): void {
  fireEvent(
    row,
    new MouseEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: 120,
    })
  );
}

async function pointerDrop(
  source: string,
  target: string,
  horizontalMoves: number[]
): Promise<void> {
  const sourceRow = screen.getByRole("treeitem", { name: source });
  const targetRow = screen.getByRole("treeitem", { name: target });
  fireEvent.dragStart(sourceRow);
  fireEvent.dragEnter(targetRow);
  dragOver(targetRow, 100);
  await settleHover();
  await horizontalMoves.reduce(async (previous, clientX) => {
    await previous;
    dragOver(targetRow, clientX);
    await settleHover();
  }, Promise.resolve());
  fireEvent.drop(targetRow);
}

async function workspace(variant: string, name: string): Promise<string> {
  const workspacePath = writeRecursiveWorkspace();
  await expandRecursiveWorkspace(workspacePath);
  await materializeOverlayRow(variant, name);
  return workspacePath;
}

async function finish(
  workspacePath: string,
  target: string,
  expected: string
): Promise<void> {
  await expectTree(expected, { showGutter: true });
  await awaitRecursivePlacement(workspacePath, target);
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
}

test.each(variants)(
  "pointer-hover dropping after a terminal row through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Alpha");
    await pointerDrop("Alpha", "Beta", []);
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
              Beta
              ${markerForVariant(variant)}Alpha
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await finish(workspacePath, "alpha", expected);
  }
);

test.each(variants)(
  "pointer-hover dropping before terminal siblings through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Gamma");
    await pointerDrop("Gamma", "Terminal Parent", [140]);
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
    await finish(workspacePath, "gamma", expected);
  }
);

test.each(variants)(
  "pointer-hover dropping into a terminal parent through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    await pointerDrop("Beta", "Terminal Destination", [140, 180]);
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
    await finish(workspacePath, "beta", expected);
  }
);

test.each(variants)(
  "pointer-hover dropping across a recursive source boundary [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant, "Beta");
    await pointerDrop("Beta", "Middle Destination", [140, 180]);
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
    await finish(workspacePath, "beta", expected);
  }
);
