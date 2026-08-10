import { waitFor } from "@testing-library/react";
import {
  expandOverlayWorkspace,
  readOverlayFile,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";

export const recursiveSource = [
  "# Outer <!-- id:outer -->",
  "",
  "- Outer Parent <!-- id:outer-parent -->",
  "  - Outer Before <!-- id:outer-before -->",
  '  - [Middle](#middle) <!-- id:outer-middle embed="true" -->',
  "  - Outer After <!-- id:outer-after -->",
  "- Outer Destination <!-- id:outer-destination -->",
].join("\n");

export const recursiveMiddle = [
  "# Middle <!-- id:middle -->",
  "",
  "- Middle Parent <!-- id:middle-parent -->",
  "  - Middle Before <!-- id:middle-before -->",
  '  - [Terminal](#terminal) <!-- id:middle-terminal embed="true" -->',
  "  - Middle After <!-- id:middle-after -->",
  "- Middle Destination <!-- id:middle-destination -->",
].join("\n");

export const recursiveTerminal = [
  "# Terminal <!-- id:terminal -->",
  "",
  "- Terminal Parent <!-- id:terminal-parent -->",
  "  - Alpha <!-- id:alpha -->",
  "  - Beta <!-- id:beta -->",
  "  - Gamma <!-- id:gamma -->",
  "- Terminal Destination <!-- id:terminal-destination -->",
].join("\n");

export function recursiveTree(
  outerMarker: string,
  middleMarker: string,
  terminalMarker: string,
  betaMarker: string,
  betaText: string,
  betaChildren: string
): string {
  return `
Note
  ${outerMarker}Outer
    Outer Parent
      Outer Before
      ${middleMarker}Middle
        Middle Parent
          Middle Before
          ${terminalMarker}Terminal
            Terminal Parent
              Alpha
              ${betaMarker}${betaText}${betaChildren}
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
  `;
}

export function writeRecursiveWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Outer](#outer) <!-- id:note-outer embed="true" -->',
    ].join("\n"),
    "outer.md": recursiveSource,
    "middle.md": recursiveMiddle,
    "terminal.md": recursiveTerminal,
  });
}

export async function expandRecursiveWorkspace(
  workspacePath: string
): Promise<void> {
  await expandOverlayWorkspace(workspacePath, "note.md");
}

export async function awaitRecursivePlacement(
  workspacePath: string,
  target: string
): Promise<void> {
  await waitFor(() => {
    const note = readOverlayFile(workspacePath, "note.md");
    expect(note).toContain(`](#${target})`);
    expect(note.match(new RegExp(`\\(#${target}\\)`, "gu"))).toHaveLength(1);
    expect(readOverlayFile(workspacePath, "outer.md")).toContain(
      recursiveSource
    );
    expect(readOverlayFile(workspacePath, "middle.md")).toContain(
      recursiveMiddle
    );
    expect(readOverlayFile(workspacePath, "terminal.md")).toContain(
      recursiveTerminal
    );
  });
}

test.skip("skip", () => {});
