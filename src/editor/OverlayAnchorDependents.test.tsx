import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  reparentOverlayRow,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree, setDropIndentLevel } from "../utils.test";

const variants = ["projected", "materialized-first"];

const dependentScenarios = [
  {
    title: "reparenting an anchor with two direct dependents",
    rows: [
      '    - [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
      '    - [Dependent Two](#d2) <!-- id:v2 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Dependent Two
      Dependent One
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a three-row dependent chain",
    rows: [
      '    - [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
      '    - [Dependent Two](#d2) <!-- id:v2 embed="true" after="d1" -->',
      '    - [Dependent Three](#d3) <!-- id:v3 embed="true" after="d2" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with an own-row dependent",
    rows: ['    - Own dependent <!-- id:own after="anchor" -->'],
    expected: `
Note
  Source
    Old
      Predecessor
      Own dependent
      Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a reader-relevance dependent",
    rows: [
      '    - (!) [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      {!} Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with an evidence dependent",
    rows: [
      '    - (+) [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      {+} Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a combined-marker dependent",
    rows: [
      '    - (+!) [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      {!+} Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a rewording dependent",
    rows: [
      '    - Reader wording ~~[Dependent One](#d1)~~ <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Reader wording
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a dismissed dependent",
    rows: [
      '    - (x) [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a dangling dependent",
    rows: [
      '    - [Missing dependent](#missing) <!-- id:v1 embed="true" after="anchor" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Missing dependent†
      Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
  {
    title: "reparenting an anchor with a lapsed dependent",
    rows: [
      '    - [Dependent One](#d1) <!-- id:v1 embed="true" after="missing" -->',
    ],
    expected: `
Note
  Source
    Old
      Predecessor
      Dependent One
      Dependent Two
      Dependent Three
    New
      ANCHOR
  `,
  },
];

afterEach(cleanup);

function anchorWorkspace(rows: string[]): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      '  - [Old](#old) <!-- id:old-view embed="true" -->',
      ...rows,
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Old <!-- id:old -->",
      "  - Predecessor <!-- id:pre -->",
      "  - Anchor <!-- id:anchor -->",
      "  - Dependent One <!-- id:d1 -->",
      "  - Dependent Two <!-- id:d2 -->",
      "  - Dependent Three <!-- id:d3 -->",
      "- New <!-- id:new -->",
    ].join("\n"),
  });
}

const dependentRuns = variants.flatMap((variant) =>
  dependentScenarios.map((scenario) => ({ ...scenario, variant }))
);

test.each(dependentRuns)(
  "$title [$variant]",
  async ({ rows, expected, variant }) => {
    const workspacePath = anchorWorkspace(rows);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    reparentOverlayRow("Anchor", "New", 4);
    const tree = expected.replace(
      "ANCHOR",
      `${markerForVariant(variant)}Anchor`
    );
    await expectTree(tree, { showGutter: true });
    await waitFor(() => {
      expect(
        readOverlayFile(workspacePath, "note.md").match(/\(#anchor\)/gu)
      ).toHaveLength(1);
    });
    await expectOverlayTreeAfterReload(workspacePath, tree, true);
  }
);

function selectionWorkspace(): string {
  return writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
      '  - [Old](#old) <!-- id:old-view embed="true" -->',
      '    - [Anchor](#anchor) <!-- id:anchor-view embed="true" after="pre" -->',
      '    - [Dependent One](#d1) <!-- id:v1 embed="true" after="anchor" -->',
      '    - [Dependent Two](#d2) <!-- id:v2 embed="true" after="anchor" -->',
      '    - [Dependent Three](#d3) <!-- id:v3 embed="true" after="d1" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:source -->",
      "",
      "- Old <!-- id:old -->",
      "  - Predecessor <!-- id:pre -->",
      "  - Anchor <!-- id:anchor -->",
      "  - Dependent One <!-- id:d1 -->",
      "  - Dependent Two <!-- id:d2 -->",
      "  - Dependent Three <!-- id:d3 -->",
      "- New <!-- id:new -->",
    ].join("\n"),
  });
}

function selectRow(name: string): void {
  fireEvent.click(screen.getByRole("treeitem", { name }), { metaKey: true });
}

test.each(variants)(
  "moving an anchor and one dependent from a fan-out [%s]",
  async (variant) => {
    const workspacePath = selectionWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await userEvent.click(screen.getByRole("treeitem", { name: "Anchor" }));
    selectRow("Dependent One");
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Anchor" }));
    setDropIndentLevel("Anchor", "New", 4);
    fireEvent.drop(screen.getByRole("treeitem", { name: "New" }));
    const expected = `
Note
  Source
    Old
      Predecessor
      Dependent Two
      Dependent Three
    New
      ${markerForVariant(variant)}Anchor
      Dependent One
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an anchor and its complete dependent chain [%s]",
  async (variant) => {
    const workspacePath = selectionWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await userEvent.click(screen.getByRole("treeitem", { name: "Anchor" }));
    selectRow("Dependent One");
    selectRow("Dependent Two");
    selectRow("Dependent Three");
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Anchor" }));
    setDropIndentLevel("Anchor", "New", 4);
    fireEvent.drop(screen.getByRole("treeitem", { name: "New" }));
    const expected = `
Note
  Source
    Old
      Predecessor
    New
      ${markerForVariant(variant)}Anchor
      Dependent Two
      Dependent One
      Dependent Three
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving a predecessor and anchor while leaving their dependent [%s]",
  async (variant) => {
    const workspacePath = selectionWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Anchor");
    await userEvent.click(
      screen.getByRole("treeitem", { name: "Predecessor" })
    );
    selectRow("Anchor");
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Predecessor" }));
    setDropIndentLevel("Predecessor", "New", 4);
    fireEvent.drop(screen.getByRole("treeitem", { name: "New" }));
    const expected = `
Note
  Source
    Old
      Dependent Two
      Dependent One
      Dependent Three
    New
      Predecessor
      ${markerForVariant(variant)}Anchor
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving one dependent out of an anchor fan-out [%s]",
  async (variant) => {
    const workspacePath = selectionWorkspace();
    await expandOverlayWorkspace(workspacePath, "note.md");
    await materializeOverlayRow(variant, "Dependent One");
    reparentOverlayRow("Dependent One", "New", 4);
    const expected = `
Note
  Source
    Old
      Predecessor
      Anchor
      Dependent Two
      Dependent Three
    New
      ${markerForVariant(variant)}Dependent One
  `;
    await expectTree(expected, { showGutter: true });
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
