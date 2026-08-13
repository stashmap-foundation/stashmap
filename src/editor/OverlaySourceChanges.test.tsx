import { cleanup, waitFor } from "@testing-library/react";
import {
  expectOverlayTreeAfterReload,
  expandOverlayWorkspace,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  reparentOverlayRow,
  writeOverlayFile,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

afterEach(cleanup);

function sourceDocument(rows: string[]): string {
  return ["# Source <!-- id:source -->", "", ...rows].join("\n");
}

function baseRows(b: string): string[] {
  return [
    "- Parent P <!-- id:p -->",
    "  - A <!-- id:a -->",
    `  - ${b} <!-- id:b -->`,
    "  - C <!-- id:c -->",
    "- Parent Q <!-- id:q -->",
  ];
}

async function movedWorkspace(variant: string, b: string): Promise<string> {
  const workspacePath = writeOverlayWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Source](#source) <!-- id:embed embed="true" -->',
    ].join("\n"),
    "source.md": sourceDocument(baseRows(b)),
  });
  await expandOverlayWorkspace(workspacePath, "note.md");
  const name = b.replace(/^\([^)]*\) /u, "");
  await materializeOverlayRow(variant, name);
  reparentOverlayRow(name, "Parent Q", 4);
  const sourceMarker = new globalThis.Map([
    ["projected", "{~+} "],
    ["materialized-first", "{!} "],
  ]).get(variant);
  const marker = b.startsWith("(+~)")
    ? sourceMarker ?? ""
    : markerForVariant(variant);
  await expectTree(
    `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${marker}${name}
  `,
    { showGutter: true }
  );
  await waitFor(() => {
    expect(readOverlayFile(workspacePath, "source.md")).toContain(
      "knowstr_doc_id:"
    );
    const overlay = readOverlayFile(workspacePath, "note.md");
    expect(overlay).toContain("[Parent Q](#q)");
    expect(overlay).toContain(`[${name}](#b)`);
  });
  return workspacePath;
}

test.each(variants)(
  "source reorders the moved row's old siblings [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - C <!-- id:c -->",
        "  - B <!-- id:b -->",
        "  - A <!-- id:a -->",
        "- Parent Q <!-- id:q -->",
      ])
    );
    const expected = `
Note
  Source
    Parent P
      C
      A
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "source inserts before the moved row's old predecessor [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - Inserted <!-- id:inserted -->",
        "  - A <!-- id:a -->",
        "  - B <!-- id:b -->",
        "  - C <!-- id:c -->",
        "- Parent Q <!-- id:q -->",
      ])
    );
    const expected = `
Note
  Source
    Parent P
      Inserted
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "source inserts after the moved row's old predecessor [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - A <!-- id:a -->",
        "  - Inserted <!-- id:inserted -->",
        "  - B <!-- id:b -->",
        "  - C <!-- id:c -->",
        "- Parent Q <!-- id:q -->",
      ])
    );
    const expected = `
Note
  Source
    Parent P
      A
      Inserted
      C
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "source reparents the moved target [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - A <!-- id:a -->",
        "  - C <!-- id:c -->",
        "- Parent Q <!-- id:q -->",
        "- Parent R <!-- id:r -->",
        "  - B <!-- id:b -->",
      ])
    );
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
    Parent R
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)("source deletes the moved target [%s]", async (variant) => {
  const workspacePath = await movedWorkspace(variant, "B");
  writeOverlayFile(
    workspacePath,
    "source.md",
    sourceDocument([
      "- Parent P <!-- id:p -->",
      "  - A <!-- id:a -->",
      "  - C <!-- id:c -->",
      "- Parent Q <!-- id:q -->",
    ])
  );
  const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B†
  `;
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "source restores the moved target [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - A <!-- id:a -->",
        "  - C <!-- id:c -->",
        "- Parent Q <!-- id:q -->",
      ])
    );
    await expectOverlayTreeAfterReload(
      workspacePath,
      `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B†
  `,
      true
    );
    writeOverlayFile(workspacePath, "source.md", sourceDocument(baseRows("B")));
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)("source renames the moved target [%s]", async (variant) => {
  const workspacePath = await movedWorkspace(variant, "B");
  writeOverlayFile(
    workspacePath,
    "source.md",
    sourceDocument(baseRows("Renamed B"))
  );
  const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}Renamed B
  `;
  await expectOverlayTreeAfterReload(workspacePath, expected, true);
});

test.each(variants)(
  "source adds or changes the moved target's marker [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument(baseRows("(+~) B"))
    );
    const marker = variant === "materialized-first" ? "{!} " : "{~+} ";
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${marker}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "source removes the moved target's marker [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "(+~) B");
    writeOverlayFile(workspacePath, "source.md", sourceDocument(baseRows("B")));
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "source deletes the destination parent [%s]",
  async (variant) => {
    const workspacePath = await movedWorkspace(variant, "B");
    writeOverlayFile(
      workspacePath,
      "source.md",
      sourceDocument([
        "- Parent P <!-- id:p -->",
        "  - A <!-- id:a -->",
        "  - B <!-- id:b -->",
        "  - C <!-- id:c -->",
      ])
    );
    const expected = `
Note
  Source
    Parent P
      A
      C
    Parent Q†
      ${markerForVariant(variant)}B
  `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
