import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { clearDropIndent } from "./DroppableContainer";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(() => {
  clearDropIndent();
  cleanup();
});

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

async function finish(workspacePath: string, expected: string): Promise<void> {
  await expectTree(expected, { showGutter: true });
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
}

test.each(variants)(
  "pointer-hover dropping before a visible row [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - B <!-- id:b -->",
      "  - C <!-- id:c -->",
    ]);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "C");
    await pointerDrop("C", "Parent P", [140]);
    const expected = `
Note
  Source
    Parent P
      ${markerForVariant(variant)}C
      A
      B
  `;
    await finish(workspacePath, expected);
  }
);

test.each(variants)(
  "pointer-hover dropping after a visible row [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - B <!-- id:b -->",
      "  - C <!-- id:c -->",
    ]);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "A");
    await pointerDrop("A", "B", []);
    const expected = `
Note
  Source
    Parent P
      B
      ${markerForVariant(variant)}A
      C
  `;
    await finish(workspacePath, expected);
  }
);

test.each(variants)(
  "pointer-hover dropping into a parent [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - B <!-- id:b -->",
      "- Parent Q <!-- id:q -->",
    ]);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "B");
    await pointerDrop("B", "Parent Q", [140, 180]);
    const expected = `
Note
  Source
    Parent P
      A
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await finish(workspacePath, expected);
  }
);

test.each(variants)(
  "pointer-hover reparenting after changing indentation depth [%s]",
  async (variant) => {
    const workspacePath = workspace([
      "- Parent P <!-- id:p -->",
      "  - B <!-- id:b -->",
      "- Parent Q <!-- id:q -->",
      "  - A <!-- id:a -->",
    ]);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "B");
    await pointerDrop("B", "A", [140, 180]);
    const expected = `
Note
  Source
    Parent P
    Parent Q
      A
        ${markerForVariant(variant)}B
  `;
    await finish(workspacePath, expected);
  }
);
