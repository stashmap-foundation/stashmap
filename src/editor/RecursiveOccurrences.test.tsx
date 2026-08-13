import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expandOverlayWorkspace,
  readOverlayFile,
  reloadOverlayWorkspace,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import {
  recursiveMiddle,
  recursiveSource,
  recursiveTerminal,
} from "./RecursiveScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];
const duplicateSourceNames = ["outer.md", "middle.md", "terminal.md"];
const duplicateSourceBefore = [
  recursiveSource,
  recursiveMiddle,
  recursiveTerminal,
];
const cycleSourceNames = ["a.md", "b.md"];
const deepSourceNames = Array.from(
  { length: 8 },
  (_, index) => `n${index + 1}.md`
);

function chain(marker: string, betaOrder: string): string {
  return `Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
${betaOrder}
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination`;
}

function ordinaryChain(marker: string): string {
  return chain(
    marker,
    `              Alpha
              ${marker}Beta
              Gamma`
  );
}

function duplicateWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Outer one](#outer) <!-- id:outer-one embed="true" -->',
      '- [Outer two](#outer) <!-- id:outer-two embed="true" -->',
    ].join("\n"),
    "outer.md": recursiveSource,
    "middle.md": recursiveMiddle,
    "terminal.md": recursiveTerminal,
  });
}

async function materializeOccurrence(
  variant: string,
  name: string,
  index: number
): Promise<void> {
  if (variant === "materialized-first") {
    await userEvent.click(screen.getAllByRole("treeitem", { name })[index]);
    await userEvent.keyboard("!");
  }
}

async function awaitNote(
  workspacePath: string,
  text: string,
  target: string,
  sourceNames: string[],
  sourceBefore: string[]
): Promise<void> {
  await waitFor(() => {
    const note = readOverlayFile(workspacePath, "note.md");
    expect(note).toContain(text);
    expect(note.match(new RegExp(`\\(#${target}\\)`, "gu"))).toHaveLength(1);
    sourceNames.forEach((name, index) =>
      expect(readOverlayFile(workspacePath, name)).toContain(
        sourceBefore[index]
      )
    );
  });
}

async function expectRecursiveTree(expected: string): Promise<void> {
  await expectTree(expected, {
    showGutter: true,
    withoutReferenceRows: true,
  });
}

async function expectRecursiveReload(
  workspacePath: string,
  expected: string
): Promise<void> {
  await reloadOverlayWorkspace(workspacePath, "note.md");
  await expectRecursiveTree(expected);
}

const cycleA = [
  "# A <!-- id:a -->",
  "",
  '- [B](#b) <!-- id:a-b embed="true" -->',
  "- A Tail <!-- id:a-tail -->",
].join("\n");

const cycleB = [
  "# B <!-- id:b -->",
  "",
  '- [A again](#a) <!-- id:b-a embed="true" -->',
  "- B Tail <!-- id:b-tail -->",
].join("\n");

function cycleWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#a) <!-- id:note-a embed="true" -->',
    ].join("\n"),
    "a.md": cycleA,
    "b.md": cycleB,
  });
}

function danglingWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Outer](#outer) <!-- id:note-outer embed="true" -->',
    ].join("\n"),
    "outer.md": [
      "# Outer <!-- id:outer -->",
      "",
      '- [Missing](#missing) <!-- id:outer-missing embed="true" -->',
    ].join("\n"),
  });
}

function deepWorkspace(): string {
  const sources = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => {
      const depth = index + 1;
      const next = depth + 1;
      return [
        `n${depth}.md`,
        depth === 8
          ? [
              "# N8 <!-- id:n8 -->",
              "",
              "- Leaf One <!-- id:leaf-one -->",
              "- Leaf Two <!-- id:leaf-two -->",
            ].join("\n")
          : [
              `# N${depth} <!-- id:n${depth} -->`,
              "",
              `- [N${next}](#n${next}) <!-- id:n${depth}-n${next} embed="true" -->`,
            ].join("\n"),
      ];
    })
  );
  return writeOverlayWorkspace({
    ...sources,
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [N1](#n1) <!-- id:note-n1 embed="true" -->',
    ].join("\n"),
  });
}

function deepTree(marker: string, moved: boolean): string {
  const leaves = moved
    ? `                  Leaf Two
                  ${marker}Leaf One`
    : `                  ${marker}Leaf One
                  Leaf Two`;
  return `
Note
  N1
    N2
      N3
        N4
          N5
            N6
              N7
                N8
${leaves}
  `;
}

afterEach(cleanup);

test.each(variants)(
  "marking one terminal occurrence in duplicate recursive chains [%s]",
  async (variant) => {
    const workspacePath = duplicateWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Beta", 0);
    await userEvent.click(screen.getAllByRole("treeitem", { name: "Beta" })[0]);
    await userEvent.keyboard("?");
    const expected = `
Note
  ${ordinaryChain("{?} ")}
  ${ordinaryChain("")}
    `;
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "(?) [Beta](#beta)",
      "beta",
      duplicateSourceNames,
      duplicateSourceBefore
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "moving one terminal occurrence in duplicate recursive chains [%s]",
  async (variant) => {
    const workspacePath = duplicateWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Beta", 0);
    const source = screen.getAllByRole("treeitem", { name: "Beta" })[0];
    const target = screen.getAllByRole("treeitem", { name: "Gamma" })[0];
    fireEvent.dragStart(source);
    fireEvent.drop(target);
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = `
Note
  ${chain(
    marker,
    `              Alpha
              Gamma
              ${marker}Beta`
  )}
  ${ordinaryChain("")}
    `;
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "[Beta](#beta)",
      "beta",
      duplicateSourceNames,
      duplicateSourceBefore
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "dismissing one terminal occurrence in duplicate recursive chains [%s]",
  async (variant) => {
    const workspacePath = duplicateWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Beta", 0);
    await userEvent.click(screen.getAllByRole("treeitem", { name: "Beta" })[0]);
    await userEvent.keyboard("x");
    const expected = `
Note
  ${chain(
    "",
    `              Alpha
              Gamma`
  )}
  ${ordinaryChain("")}
    `;
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "(x) [Beta](#beta)",
      "beta",
      duplicateSourceNames,
      duplicateSourceBefore
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "marking a boundary row in a mutual recursive cycle [%s]",
  async (variant) => {
    const workspacePath = cycleWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "A again", 0);
    await userEvent.click(screen.getByRole("treeitem", { name: "A again" }));
    await userEvent.keyboard("?");
    const expected = `
Note
  A
    B↩
      {?} A again
      B Tail
    A Tail
    `;
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "(?) [A again](#b-a)",
      "b-a",
      cycleSourceNames,
      [cycleA, cycleB]
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "opening a recursive cycle boundary starts from a fresh path [%s]",
  async (variant) => {
    const workspacePath = cycleWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "A again", 0);
    await userEvent.click(screen.getByLabelText("open A again in fullscreen"));
    await userEvent.click(screen.getByLabelText("expand B"));
    await expectRecursiveTree(`
A
  B↩
    A again↩
    B Tail
  A Tail
    `);
    await userEvent.click(screen.getByLabelText("open A again in fullscreen"));
    await expectRecursiveTree(`
A
  B↩
    A again↩
    B Tail
  A Tail
    `);
    if (variant === "materialized-first") {
      await awaitNote(
        workspacePath,
        "(!) [A again](#b-a)",
        "b-a",
        cycleSourceNames,
        [cycleA, cycleB]
      );
    }
  }
);

test.each(variants)(
  "an unreachable recursive boundary opens nothing [%s]",
  async (variant) => {
    const workspacePath = danglingWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Missing", 0);
    await expectRecursiveTree(`
Note
  Outer
    ${variant === "materialized-first" ? "{!} " : ""}Missing†
    `);
    expect(screen.queryByLabelText("open Missing in fullscreen")).toBeNull();
    if (variant === "materialized-first") {
      await waitFor(() =>
        expect(readOverlayFile(workspacePath, "note.md")).toContain(
          "(!) [Missing](#outer-missing)"
        )
      );
    }
  }
);

test.each(variants)(
  "moving a boundary row in a mutual recursive cycle [%s]",
  async (variant) => {
    const workspacePath = cycleWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "A again", 0);
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "A again" }));
    fireEvent.drop(screen.getByRole("treeitem", { name: "B Tail" }));
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = `
Note
  A
    B
      B Tail
      ${marker}A again
    A Tail
    `;
    await expectRecursiveTree(expected);
    await awaitNote(workspacePath, "[A again](#b-a)", "b-a", cycleSourceNames, [
      cycleA,
      cycleB,
    ]);
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "marking a terminal row through eight acyclic embeds [%s]",
  async (variant) => {
    const workspacePath = deepWorkspace();
    const sourceBefore = deepSourceNames.map((name) =>
      readOverlayFile(workspacePath, name)
    );
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Leaf One", 0);
    await userEvent.click(screen.getByRole("treeitem", { name: "Leaf One" }));
    await userEvent.keyboard("?");
    const expected = deepTree("{?} ", false);
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "(?) [Leaf One](#leaf-one)",
      "leaf-one",
      deepSourceNames,
      sourceBefore
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);

test.each(variants)(
  "moving a terminal row through eight acyclic embeds [%s]",
  async (variant) => {
    const workspacePath = deepWorkspace();
    const sourceBefore = deepSourceNames.map((name) =>
      readOverlayFile(workspacePath, name)
    );
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOccurrence(variant, "Leaf One", 0);
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Leaf One" }));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Leaf Two" }));
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = deepTree(marker, true);
    await expectRecursiveTree(expected);
    await awaitNote(
      workspacePath,
      "[Leaf One](#leaf-one)",
      "leaf-one",
      deepSourceNames,
      sourceBefore
    );
    await expectRecursiveReload(workspacePath, expected);
  }
);
