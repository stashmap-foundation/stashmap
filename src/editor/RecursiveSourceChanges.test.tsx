import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  markerForVariant,
  materializeOverlayRow,
  readOverlayFile,
  reloadOverlayWorkspace,
  writeOverlayFile,
} from "./OverlayScenario.test";
import {
  expandRecursiveWorkspace,
  recursiveMiddle,
  recursiveSource,
  recursiveTerminal,
  recursiveTree,
  writeRecursiveWorkspace,
} from "./RecursiveScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

async function workspace(variant: string): Promise<string> {
  const workspacePath = writeRecursiveWorkspace();
  await expandRecursiveWorkspace(workspacePath);
  await materializeOverlayRow(variant, "Beta");
  if (variant === "materialized-first") {
    await waitFor(() =>
      expect(readOverlayFile(workspacePath, "note.md")).toContain(
        "(!) [Beta](#beta)"
      )
    );
  }
  return workspacePath;
}

function terminalRows(rows: string[]): string {
  return ["# Terminal <!-- id:terminal -->", "", ...rows].join("\n");
}

afterEach(cleanup);

test.each(variants)(
  "terminal source renames a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace(
        "- Beta <!-- id:beta -->",
        "- Renamed Beta <!-- id:beta -->"
      )
    );
    const expected = recursiveTree(
      "",
      "",
      "",
      markerForVariant(variant),
      "Renamed Beta",
      ""
    );
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source inserts before a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace(
        "  - Beta <!-- id:beta -->",
        "  - Inserted <!-- id:inserted -->\n  - Beta <!-- id:beta -->"
      )
    );
    const expected = recursiveTree(
      "",
      "",
      "",
      markerForVariant(variant),
      "Beta",
      ""
    ).replace(
      "              Alpha\n",
      "              Alpha\n              Inserted\n"
    );
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source reorders a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      terminalRows([
        "- Terminal Parent <!-- id:terminal-parent -->",
        "  - Gamma <!-- id:gamma -->",
        "  - Beta <!-- id:beta -->",
        "  - Alpha <!-- id:alpha -->",
        "- Terminal Destination <!-- id:terminal-destination -->",
      ])
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
              ${markerForVariant(variant)}Beta
              Alpha
            Terminal Destination
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source reparents a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      terminalRows([
        "- Terminal Parent <!-- id:terminal-parent -->",
        "  - Alpha <!-- id:alpha -->",
        "  - Gamma <!-- id:gamma -->",
        "- Terminal Destination <!-- id:terminal-destination -->",
        "  - Beta <!-- id:beta -->",
      ])
    );
    const expected = recursiveTree(
      "",
      "",
      "",
      markerForVariant(variant),
      "Beta",
      ""
    )
      .replace(`              ${markerForVariant(variant)}Beta\n`, "")
      .replace(
        "            Terminal Destination",
        `            Terminal Destination\n              ${markerForVariant(
          variant
        )}Beta`
      );
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source deletes a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace("  - Beta <!-- id:beta -->\n", "")
    );
    const beta = variant === "materialized-first" ? "\n    {!} Beta†" : "";
    const expected = recursiveTree("", "", "", "", "Beta", "")
      .replace("              Beta\n", "")
      .replace("    Outer Destination", `    Outer Destination${beta}`);
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source restores a recursively materialized row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace("  - Beta <!-- id:beta -->\n", "")
    );
    await expectOverlayTreeAfterReload(
      workspacePath,
      recursiveTree("", "", "", "", "Beta", "")
        .replace("              Beta\n", "")
        .replace(
          "    Outer Destination",
          `    Outer Destination${
            variant === "materialized-first" ? "\n    {!} Beta†" : ""
          }`
        ),
      true
    );
    writeOverlayFile(workspacePath, "terminal.md", recursiveTerminal);
    const expected = recursiveTree(
      "",
      "",
      "",
      markerForVariant(variant),
      "Beta",
      ""
    );
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "middle source reparents its terminal embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "middle.md",
      recursiveMiddle
        .replace(
          '  - [Terminal](#terminal) <!-- id:middle-terminal embed="true" -->\n',
          ""
        )
        .replace(
          "- Middle Destination <!-- id:middle-destination -->",
          '- Middle Destination <!-- id:middle-destination -->\n  - [Terminal](#terminal) <!-- id:middle-terminal embed="true" -->'
        )
    );
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
              ${markerForVariant(variant)}Beta
              Gamma
            Terminal Destination
      Outer After
    Outer Destination
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "outer source reparents its middle embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "outer.md",
      recursiveSource
        .replace(
          '  - [Middle](#middle) <!-- id:outer-middle embed="true" -->\n',
          ""
        )
        .replace(
          "- Outer Destination <!-- id:outer-destination -->",
          '- Outer Destination <!-- id:outer-destination -->\n  - [Middle](#middle) <!-- id:outer-middle embed="true" -->'
        )
    );
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Outer After
    Outer Destination
      Middle
        Middle Parent
          Middle Before
          Terminal
            Terminal Parent
              Alpha
              ${markerForVariant(variant)}Beta
              Gamma
            Terminal Destination
          Middle After
        Middle Destination
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "middle source retargets its terminal embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "alternative.md",
      "# Alternative <!-- id:alternative -->"
    );
    writeOverlayFile(
      workspacePath,
      "middle.md",
      recursiveMiddle.replace(
        '[Terminal](#terminal) <!-- id:middle-terminal embed="true" -->',
        '[Alternative](#alternative) <!-- id:middle-terminal embed="true" -->'
      )
    );
    const retained = variant === "materialized-first" ? "\n    {!} Beta" : "";
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          Alternative
          Middle After
        Middle Destination
      Outer After
    Outer Destination${retained}
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "middle source changes its terminal embed to inline prose [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "middle.md",
      recursiveMiddle.replace(
        '[Terminal](#terminal) <!-- id:middle-terminal embed="true" -->',
        'See [Terminal](#terminal) here <!-- id:middle-terminal embed="true" -->'
      )
    );
    const retained = variant === "materialized-first" ? "\n    {!} Beta" : "";
    const expected = `
Note
  Outer
    Outer Parent
      Outer Before
      Middle
        Middle Parent
          Middle Before
          See Terminal here
          Middle After
        Middle Destination
      Outer After
    Outer Destination${retained}
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source marker changes through two embeds [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace(
        "- Beta <!-- id:beta -->",
        "- (+) Beta <!-- id:beta -->"
      )
    );
    const marker = variant === "materialized-first" ? "{!} " : "{+} ";
    const expected = recursiveTree("", "", "", marker, "Beta", "");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "middle source deletes its terminal embed [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    writeOverlayFile(
      workspacePath,
      "middle.md",
      recursiveMiddle.replace(
        '  - [Terminal](#terminal) <!-- id:middle-terminal embed="true" -->\n',
        ""
      )
    );
    const retained = variant === "materialized-first" ? "\n    {!} Beta" : "";
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
      Outer After
    Outer Destination${retained}
    `;
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "terminal source breaks a recursive evidence edge [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("+");
    await waitFor(() =>
      expect(readOverlayFile(workspacePath, "note.md")).toContain(
        "[Beta](#beta)"
      )
    );
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      terminalRows([
        "- Terminal Parent <!-- id:terminal-parent -->",
        "  - Alpha <!-- id:alpha -->",
        "  - Gamma <!-- id:gamma -->",
        "- Terminal Destination <!-- id:terminal-destination -->",
        "  - Beta <!-- id:beta -->",
      ])
    );
    const marker = variant === "materialized-first" ? "{!+} " : "{+} ";
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
              ${marker}Beta
            Terminal Destination
              Beta
          Middle After
        Middle Destination
      Outer After
    Outer Destination
    `;
    await reloadOverlayWorkspace(workspacePath, "note.md");
    await expectTree(expected, {
      showGutter: true,
      withoutReferenceRows: true,
    });
  }
);

test.each(variants)(
  "terminal source renames a recursively reworded row [%s]",
  async (variant) => {
    const workspacePath = await workspace(variant);
    const editor = screen.getByRole("textbox", { name: "edit Beta" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Reader Beta{Escape}");
    await waitFor(() =>
      expect(readOverlayFile(workspacePath, "note.md")).toContain("Reader Beta")
    );
    writeOverlayFile(
      workspacePath,
      "terminal.md",
      recursiveTerminal.replace(
        "- Beta <!-- id:beta -->",
        "- Source Renamed Beta <!-- id:beta -->"
      )
    );
    const expected = recursiveTree(
      "",
      "",
      "",
      markerForVariant(variant),
      "Reader Beta",
      ""
    );
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
