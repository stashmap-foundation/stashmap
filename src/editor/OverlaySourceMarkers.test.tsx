import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  readOverlayFile,
  reparentOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function markerWorkspace(marker: string): string {
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
      `  - ${marker} B <!-- id:b -->`,
      "  - C <!-- id:c -->",
      "- Parent Q <!-- id:q -->",
    ].join("\n"),
  });
}

async function materializeMarkerRow(
  variant: string,
  renderedMarker: string
): Promise<void> {
  if (variant !== "materialized-first") {
    return;
  }
  reparentOverlayRow("B", "C", 4);
  await expectTree(
    `
Note
  Source
    Parent P
      A
      C
      ${renderedMarker}B
    Parent Q
  `,
    { showGutter: true }
  );
}

async function expectSourceUnchanged(
  workspacePath: string,
  sourceBefore: string
): Promise<void> {
  await waitFor(() =>
    expect(readOverlayFile(workspacePath, "source.md")).toContain(sourceBefore)
  );
}

async function moveSourceMarker(
  variant: string,
  sourceMarker: string,
  renderedMarker: string
): Promise<void> {
  const workspacePath = markerWorkspace(sourceMarker);
  const sourceBefore = readOverlayFile(workspacePath, "source.md");
  await expandOverlayWorkspace(workspacePath, "note.md");
  await materializeMarkerRow(variant, renderedMarker);
  reparentOverlayRow("B", "Parent Q", 4);
  const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${renderedMarker}B
  `;
  await expectTree(expected, { showGutter: true });
  await expectSourceUnchanged(workspacePath, sourceBefore);
  const note = readOverlayFile(workspacePath, "note.md");
  expect(note.match(/\[B\]\(#b\)/gu)).toHaveLength(1);
  expect(note).not.toMatch(/^\s+- \([^)]*[+-][^)]*\) \[B\]\(#b\)/mu);
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
}

test.each(variants)(
  "moving a source-authored confirms-only row [%s]",
  async (variant) => {
    await moveSourceMarker(variant, "(+)", "{+} ");
  }
);

test.each(variants)(
  "moving a source-authored contradicts-only row [%s]",
  async (variant) => {
    await moveSourceMarker(variant, "(-)", "{-} ");
  }
);

test.each(variants)(
  "moving a source-authored combined negative row [%s]",
  async (variant) => {
    await moveSourceMarker(variant, "(-~)", "{~-} ");
  }
);

test.each(variants)(
  "moving a source-authored dismissed row through the dismissal filter [%s]",
  async (variant) => {
    const workspacePath = markerWorkspace("(x)");
    const sourceBefore = readOverlayFile(workspacePath, "source.md");
    await expandOverlayWorkspace(workspacePath, "note.md");
    await userEvent.click(
      screen.getByRole("button", { name: "toggle Not Relevant filter" })
    );
    await materializeMarkerRow(variant, "{x} ");
    reparentOverlayRow("B", "Parent Q", 4);
    const visible = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      {x} B
  `;
    await expectTree(visible, { showGutter: true });
    await userEvent.click(
      screen.getByRole("button", { name: "toggle Not Relevant filter" })
    );
    const hidden = `
Note
  Source
    Parent P
      A
      C
    Parent Q
  `;
    await expectTree(hidden, { showGutter: true });
    await userEvent.click(
      screen.getByRole("button", { name: "toggle Not Relevant filter" })
    );
    await expectTree(visible, { showGutter: true });
    await expectSourceUnchanged(workspacePath, sourceBefore);
    await expectOverlayTreeAfterReload(workspacePath, hidden, true);
    await userEvent.click(
      screen.getByRole("button", { name: "toggle Not Relevant filter" })
    );
    await expectTree(visible, { showGutter: true });
  }
);
