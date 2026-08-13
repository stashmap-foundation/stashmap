import fs from "fs";
import os from "os";
import pathModule from "path";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nip19 } from "nostr-tools";
import {
  ALICE,
  BOB,
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  openNodeInFullscreen,
  readonlyRoute,
  renderApp,
  requireUser,
  setDropIndentLevel,
  setup,
  type,
} from "../utils.test";
import { renderAppTree } from "../appTestUtils.test";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { LOCAL } from "../core/nodeRef";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { expectTargets } from "./Multiselect.testUtils";

afterEach(cleanup);

function writeWorkspace(files: Record<string, string>): string {
  const workspacePath = fs.mkdtempSync(
    pathModule.join(os.tmpdir(), "knowstr-embed-")
  );
  Object.entries(files).forEach(([name, content]) => {
    fs.writeFileSync(pathModule.join(workspacePath, name), content);
  });
  return workspacePath;
}

async function openExpandedWorkspace(
  files: Record<string, string>
): Promise<string> {
  const workspacePath = writeWorkspace(files);
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  return workspacePath;
}

test("plain block links stay links; embeds project live text and children recursively", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      "- Prose with an inline [Other](#oth) mention <!-- id:mix -->",
      "- [Other Label](#oth) <!-- id:plain -->",
      '- [Old Label](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      '  - [Detail](#det) <!-- id:demb embed="true" -->',
    ].join("\n"),
    "detail.md": [
      "# Detail Document <!-- id:det -->",
      "",
      "- Deep leaf <!-- id:leaf -->",
    ].join("\n"),
    "other.md": [
      "# Other Document <!-- id:oth -->",
      "",
      "- Other child <!-- id:oc -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Prose with an inline Other mention
  Other Label
  Source
    Argument A
      Detail Document
        Deep leaf
  `);
});

test("placement claims compose per the fixture rules", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Old](#src) <!-- id:emb embed="true" -->',
      '  - (!) [c](#c) <!-- id:o1 embed="true" -->',
      "    - Meine Anmerkung <!-- id:o2 -->",
      '  - (x) [d](#d) <!-- id:o3 embed="true" -->',
      '  - [a](#a) <!-- id:o4 embed="true" after="e" -->',
      "  - My own row <!-- id:o5 -->",
      '  - [b](#b) <!-- id:o6 embed="true" -->',
      '    - (!) [b1](#b1) <!-- id:o7 embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
      "- Argument C <!-- id:c -->",
      "- Argument D <!-- id:d -->",
      "- Argument E <!-- id:e -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(
    `
Note
  Source
    Argument B
      {!} Beleg B1
    {!} Argument C
      Meine Anmerkung
    Argument E
    Argument A
    My own row
  `,
    { showGutter: true }
  );
});

test("rewordings speak the reader's words and project the target", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - Kapital flieht vor Unberechenbarkeit ~~[c label](#c)~~ <!-- id:o1 embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument C <!-- id:c -->",
      "  - C Beleg <!-- id:c1 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Source
    Argument A
    Kapital flieht vor Unberechenbarkeit
      C Beleg
  `);
});

test("renaming a projected row materializes a rewording", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  const editor = await screen.findByRole("textbox", {
    name: "edit Argument C",
  });
  await userEvent.clear(editor);
  await userEvent.type(editor, "Meine Worte{Escape}");

  await expectTree(`
Note
  Source
    Argument A
    Meine Worte
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- Meine Worte ~~\[Argument C\]\(#c\)~~ <!-- id:\S+ embed="true" -->/u
    );
  });

  const source = fs.readFileSync(pathModule.join(workspacePath, "source.md"), {
    encoding: "utf8",
  });
  expect(source).toContain("- Argument C <!-- id:c -->");
});

test("marking a drifted placement keeps the placement form", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - [Old Label](#a) <!-- id:cl embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Renamed Argument <!-- id:a -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(
    screen.getByRole("treeitem", { name: "Renamed Argument" })
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Source
    {!} Renamed Argument
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \(!\) \[Old Label\]\(#a\) <!-- id:cl embed="true" -->/u
    );
    expect(note).not.toContain("~~");
  });
});

test("evidence on a relevance-marked row gains the parent line", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(screen.getByRole("treeitem", { name: "Beleg B1" }));
  await userEvent.keyboard("!");

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(/- \(!\) \[Beleg B1\]\(#b1\)/u);
    expect(note).not.toContain("(#b)");
  });

  await userEvent.keyboard("+");

  await expectTree(
    `
Note
  Source
    Argument B
      {!+} Beleg B1
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Argument B\]\(#b\) <!-- id:\S+ embed="true" -->\n {4}- \(\+!\) \[Beleg B1\]\(#b1\) <!-- id:\S+ embed="true" -->/u
    );
    expect(note.match(/\(#b1\)/gu)).toHaveLength(1);
  });
});

test("evidence on a written line keeps the reader's subtree and its id", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - (!) [Beleg B1](#b1) <!-- id:m1 embed="true" -->',
      "    - Meine Notiz <!-- id:own -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Beleg B1" }));
  await userEvent.keyboard("+");

  await expectTree(
    `
Note
  Source
    Argument B
      {!+} Beleg B1
        Meine Notiz
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Argument B\]\(#b\) <!-- id:\S+ embed="true" -->\n {4}- \(\+!\) \[Beleg B1\]\(#b1\) <!-- id:m1 embed="true" -->\n {6}- Meine Notiz <!-- id:own -->/u
    );
    expect(note.match(/\(#b1\)/gu)).toHaveLength(1);
  });

  cleanup();
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await expectTree(
    `
Note
  Source
    Argument B
      {!+} Beleg B1
        Meine Notiz
  `,
    { showGutter: true }
  );
});

test("renaming a source-judged row writes no marker of its own", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- (!) Argument C <!-- id:c -->",
    ].join("\n"),
  });

  const editor = await screen.findByRole("textbox", {
    name: "edit Argument C",
  });
  await userEvent.clear(editor);
  await userEvent.type(editor, "Meine Worte{Escape}");

  await expectTree(
    `
Note
  Source
    {!} Meine Worte
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- Meine Worte ~~\[Argument C\]\(#c\)~~ <!-- id:\S+ embed="true" -->/u
    );
    expect(note).not.toContain("(!) Meine Worte");
  });
});

test("rewording twice keeps the original source bond", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  const first = await screen.findByRole("textbox", {
    name: "edit Argument A",
  });
  await userEvent.clear(first);
  await userEvent.type(first, "First wording{Escape}");

  const second = await screen.findByRole("textbox", {
    name: "edit First wording",
  });
  await userEvent.clear(second);
  await userEvent.type(second, "Second wording{Escape}");

  await expectTree(`
Note
  Source
    Second wording
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- Second wording ~~\[Argument A\]\(#a\)~~ <!-- id:\S+ embed="true" -->/u
    );
    expect(note).not.toContain("~~[First wording](#a)~~");
  });
});

test("dragging a projected row writes a position claim", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument A" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument C" }));

  await expectTree(`
Note
  Source
    Argument B
    Argument C
    Argument A
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Argument A\]\(#a\) <!-- id:\S+ embed="true" after="c" -->/u
    );
  });
});

test("Log entries are plain links and stay flat", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderApp(alice());

  await type("My Notes{Enter}{Tab}Child{Escape}");
  await userEvent.click(await screen.findByLabelText("Navigate to Log"));

  const [logRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(logRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
~Log
  My Notes
  `);

  await waitFor(() => {
    const logDoc = relayPool
      .getDecryptedEvents()
      .filter(
        (event) =>
          event.kind === KIND_KNOWLEDGE_DOCUMENT &&
          event.content.includes("~Log")
      )
      .at(-1)?.content;
    if (!logDoc) {
      throw new Error("Missing log document event");
    }
    expect(logDoc).toContain("[My Notes](#");
    expect(logDoc).not.toContain('embed="true"');
  });
});

test("a dragged row becomes an embed that projects and takes marks in a drill-down surface", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Source Document{Enter}{Tab}Source{Enter}{Tab}Descendant{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Target Document{Enter}{Tab}Target{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Source");
  await openNodeInFullscreen(0, "Source");
  await navigateToNodeViaSearch(1, "Target");
  await openNodeInFullscreen(1, "Target");

  const source = getPane(0).getByRole("treeitem", { name: "Source" });
  const target = getPane(1).getByRole("treeitem", { name: "Target" });
  fireEvent.dragStart(source);
  fireEvent.drop(target);

  await expectTree(`
Source
  Descendant
  [I] Target Document / Target ↩
Target
  Source
  `);

  await userEvent.click(getPane(1).getByLabelText("expand Source"));

  await expectTree(`
Source
  Descendant
  [I] Target Document / Target ↩
Target
  Source
    Descendant
  `);

  await userEvent.click(
    getPane(1).getByRole("treeitem", { name: "Descendant" })
  );
  await userEvent.keyboard("{Backspace}");

  await expectTree(
    `
Source
  Descendant
  [I] Target Document / Target ↩
Target
  Source
    Descendant
  `,
    { showGutter: true }
  );

  await userEvent.click(
    getPane(1).getByRole("treeitem", { name: "Descendant" })
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Source
  Descendant
  [I] Target Document / Target ↩
Target
  Source
    {!} Descendant
  `,
    { showGutter: true }
  );
});

test("a deep relevance mark writes one line and binds in place", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
      "  - Beleg B2 <!-- id:b2 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(screen.getByRole("treeitem", { name: "Beleg B1" }));
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Source
    Argument B
      {!} Beleg B1
      Beleg B2
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[S\]\(#src\) <!-- id:emb embed="true" -->\n {2}- \(!\) \[Beleg B1\]\(#b1\) <!-- id:\S+ embed="true" -->/u
    );
    expect(note).not.toContain("(#b)");
  });
});

test("marking a great-grandchild folds nothing", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "  - Detail B <!-- id:b -->",
      "    - Fact C <!-- id:c -->",
      "      - Source D <!-- id:d -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(screen.getByRole("treeitem", { name: "Fact C" }));
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Source
    Argument A
      Detail B
        {!} Fact C
          Source D
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[S\]\(#src\) <!-- id:emb embed="true" -->\n {2}- \(!\) \[Fact C\]\(#c\) <!-- id:\S+ embed="true" -->/u
    );
    expect(note).not.toContain("(#a)");
    expect(note).not.toContain("(#b)");
  });
});

test("evidence writes the parent line beneath the embed", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(screen.getByRole("treeitem", { name: "Beleg B1" }));
  await userEvent.keyboard("+");

  await expectTree(
    `
Note
  Source
    Argument B
      {+} Beleg B1
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[S\]\(#src\) <!-- id:emb embed="true" -->\n {2}- \[Argument B\]\(#b\) <!-- id:\S+ embed="true" -->\n {4}- \(\+\) \[Beleg B1\]\(#b1\) <!-- id:\S+ embed="true" -->/u
    );
  });
});

test("marking two rows announces the note once, at the top", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - (!) [b](#b) <!-- id:o1 embed="true" -->',
      '  - (!) [c](#c) <!-- id:o2 embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument B <!-- id:b -->",
      "  - Beleg B1 <!-- id:b1 -->",
      "- Argument C <!-- id:c -->",
      "  - Beleg C1 <!-- id:c1 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "source.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Source
  Argument B
    Beleg B1
  Argument C
    Beleg C1
  [I] Note ↩
  `);
});

test("moving a row before its marked sibling keeps both claims", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  await userEvent.keyboard("!");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  setDropIndentLevel("Casa Battlo", "Gaudi", 6);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Casa Battlo
          {!} Sagrada Familia
          Casa Mila
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Gaudi\]\(#g\) <!-- id:\S+ embed="true" -->\n {4}- \[Casa Battlo\]\(#cb\) <!-- id:\S+ embed="true" before="\S+" -->/u
    );
    expect(note).toMatch(/- \(!\) \[Sagrada Familia\]\(#sf\)/u);
  });
});

test("moving a row to another parent shows it only there", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Barcelona" }));

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Casa Mila
        Gaudi
          Sagrada Familia
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Barcelona\]\(#bc\) <!-- id:\S+ embed="true" -->\n {4}- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" before="g" parent="bc" -->/u
    );
  });
});

test("dragging a projected row out of the embed integrates it there", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      "- My own row <!-- id:own -->",
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "My own row" }));

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
  My own row
  Casa Mila
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- My own row <!-- id:own -->\n- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" from="emb" after="own" parent="note" -->/u
    );
  });
});

test("dragging a marked row moves its written line", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      "- My own row <!-- id:own -->",
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  await userEvent.keyboard("!");
  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          {!} Sagrada Familia
          Casa Mila
  My own row
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "My own row" }));

  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Casa Mila
  My own row
  {!} Sagrada Familia
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[A\]\(#art\) <!-- id:emb embed="true" -->\n- My own row <!-- id:own -->\n- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:\S+ embed="true" from="emb" after="own" parent="note" -->/u
    );
  });
});

test("dragging a marked row back into the embed moves it home", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      "- Studien <!-- id:st -->",
      '  - (!) [Sagrada Familia](#sf) <!-- id:moved embed="true" -->',
      '  - [A](#art) <!-- id:emb embed="true" -->',
      '    - (!) [Casa Mila](#cm) <!-- id:cmc embed="true" -->',
      '    - (!) [Barcelona](#bc) <!-- id:bcc embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(
    `
Note
  Studien
    {!} Sagrada Familia
    Art Noveau
      Spain
        {!} Barcelona
          Gaudi
            {!} Casa Mila
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(
    `
Note
  Studien
    Art Noveau
      Spain
        {!} Barcelona
          Gaudi
            {!} Sagrada Familia
            {!} Casa Mila
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \(!\) \[Barcelona\]\(#bc\) <!-- id:bcc embed="true" -->\n {6}- \[Gaudi\]\(#g\) <!-- id:\S+ embed="true" -->\n {8}- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:moved embed="true" before="cmc" parent="g" -->/u
    );
    expect(note).not.toMatch(/^ {2}- \(!\) \[Sagrada Familia\]/mu);
  });
});

test("dropping a marked row after a marked sibling anchors to the base row", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      "- Studien <!-- id:st -->",
      '  - (!) [Sagrada Familia](#sf) <!-- id:moved embed="true" -->',
      '  - [A](#art) <!-- id:emb embed="true" -->',
      '    - (!) [Casa Mila](#cm) <!-- id:cmc embed="true" -->',
      '    - (!) [Barcelona](#bc) <!-- id:bcc embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Mila" }));

  await expectTree(
    `
Note
  Studien
    Art Noveau
      Spain
        {!} Barcelona
          Gaudi
            {!} Casa Mila
            {!} Sagrada Familia
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:moved embed="true" after="cmc" parent="g" -->/u
    );
    expect(note).not.toMatch(/^ {2}- \(!\) \[Sagrada Familia\]/mu);
  });
});

test("moving a marked row deep in the projection writes only the anchor", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          {!} Sagrada Familia
          Casa Battlo
          Casa Mila
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Mila" }));

  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Casa Battlo
          Casa Mila
          {!} Sagrada Familia
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:\S+ embed="true" after="cm" -->/u
    );
  });
});

test("a second move replaces the position claim whole", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Mila" }));

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Mila
          Casa Battlo
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Barcelona" }));

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Casa Battlo
        Gaudi
          Sagrada Familia
          Casa Mila
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:\S+ embed="true" before="\S+" parent="bc" -->/u
    );
    expect(note).not.toContain('after="cm"');
  });
});

test("moving a source row re-anchors claims that pointed at it", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - (!) Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
      "      - (+~) Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Mila" }));

  await expectTree(
    `
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Casa Battlo
          {~+} Casa Mila
          {!} Sagrada Familia
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  setDropIndentLevel("Casa Mila", "Spain", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Spain" }));

  await expectTree(
    `
Note
  Art Noveau
    Spain
      {~+} Casa Mila
      Barcelona
        Gaudi
          Casa Battlo
          {!} Sagrada Familia
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:\S+ embed="true" after="cb" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" before="bc" parent="sp" -->/u
    );
    expect(note).not.toMatch(/\[Sagrada Familia\][^\n]*after="cm"/u);
  });
});

test("moving a claim to the top demotes competing first claims", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:emb embed="true" -->',
      '  - [Gaudi](#g) <!-- id:gc embed="true" -->',
      '    - [Sagrada Familia](#sf) <!-- id:sfc embed="true" parent="g" -->',
      '    - [Casa Mila](#cm) <!-- id:cmc embed="true" parent="g" -->',
      '    - (!) [Casa Battlo](#cb) <!-- id:cbc embed="true" parent="g" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Gaudi <!-- id:g -->",
      "  - Sagrada Familia <!-- id:sf -->",
      "  - Casa Battlo <!-- id:cb -->",
      "  - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  setDropIndentLevel("Sagrada Familia", "Gaudi", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(
    `
Note
  Art Noveau
    Gaudi
      Sagrada Familia
      {!} Casa Battlo
      Casa Mila
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:sfc embed="true" before="cbc" -->/u
    );
    expect(note).toMatch(
      /- \(!\) \[Casa Battlo\]\(#cb\) <!-- id:cbc embed="true" after="sfc" before="cmc" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:cmc embed="true" after="cbc" -->/u
    );
  });
});

test("moving a shared anchor changes only the containing note", async () => {
  const other = [
    "# Other <!-- id:other -->",
    "",
    '- [Art Noveau](#art) <!-- id:other-emb embed="true" -->',
    '  - [Sagrada Familia](#sf) <!-- id:other-sf embed="true" after="cb" -->',
  ].join("\n");
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:emb embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:sfc embed="true" after="cb" -->',
      '  - [Casa Battlo](#cb) <!-- id:cbc embed="true" before="sf" -->',
    ].join("\n"),
    "other.md": other,
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Battlo <!-- id:cb -->",
      "- Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Mila" }));

  await waitFor(() => {
    expect(
      fs.readFileSync(pathModule.join(workspacePath, "other.md"), "utf8")
    ).toBe(other);
  });
});

test("a mark in one embed leaves a sibling embed whole", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb1 embed="true" -->',
      '- [A](#art) <!-- id:emb2 embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await userEvent.click(
    screen.getAllByRole("treeitem", { name: "Casa Mila" })[0]
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Art Noveau
    Sagrada Familia
    {!} Casa Mila
    [I] Note ↩
  Art Noveau
    Sagrada Familia
    Casa Mila
    [I] Note ↩
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[A\]\(#art\) <!-- id:emb1 embed="true" -->\n {2}- \(!\) \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" -->\n- \[A\]\(#art\) <!-- id:emb2 embed="true" -->/u
    );
  });
});

test("a move with a dead anchor suspends where written", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:o1 embed="true" after="spain" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Barcelona <!-- id:b -->",
      "  - Gaudi <!-- id:g -->",
      "    - Sagrada Familia <!-- id:sf -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Source
    Barcelona
      Gaudi
    Sagrada Familia
  `);
});

test("a stale anchor follows the line it names", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      "- Studien <!-- id:st -->",
      '  - [Art Noveau](#art) <!-- id:emb embed="true" -->',
      '    - (!) [Casa Mila](#cm) <!-- id:cmc embed="true" -->',
      '    - (!) [Barcelona](#bc) <!-- id:bcc embed="true" -->',
      '    - (!) [Sagrada Familia](#sf) <!-- id:sfc embed="true" before="sp" -->',
      '    - [Casa Battlo](#cb) <!-- id:cbc embed="true" after="cmc" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
      "      - Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(
    `
Note
  Studien
    Art Noveau
      {!} Sagrada Familia
      Spain
        {!} Barcelona
          Gaudi
            {!} Casa Mila
            Casa Battlo
  `,
    { showGutter: true }
  );
});

test("a move follows its anchor out of the written list", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      '  - [Gaudi](#g) <!-- id:hop embed="true" -->',
      '    - [Casa Mila](#cm) <!-- id:o3 embed="true" after="sf" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Sagrada Familia <!-- id:sf -->",
      "    - Gaudi <!-- id:g -->",
      "      - Casa Mila <!-- id:cm -->",
      "      - Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Sagrada Familia
        Casa Mila
        Gaudi
          Casa Battlo
  `);
});

test("an anchor never crosses into a sibling embed", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb1 embed="true" -->',
      '  - [Gaudi](#g) <!-- id:hop embed="true" -->',
      '    - [Casa Mila](#cm) <!-- id:o3 embed="true" after="bc" -->',
      '- [A](#art) <!-- id:emb2 embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
      "      - Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Battlo
      Casa Mila
    [I] Note ↩
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Mila
          Casa Battlo
    [I] Note ↩
  `);
});

test("a reorder in a nested list composes where written", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      '  - [Gaudi](#g) <!-- id:hop embed="true" -->',
      '    - [Casa Battlo](#cb) <!-- id:o3 embed="true" after="cm" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
      "      - Casa Mila <!-- id:cm -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Mila
          Casa Battlo
  `);
});

test("a deleted anchor keeps the row in its list", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      '  - [Gaudi](#g) <!-- id:hop embed="true" -->',
      '    - [Casa Battlo](#cb) <!-- id:o3 embed="true" after="cm" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Battlo
  `);
});

test("a move rides its anchor through source reorders", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [A](#art) <!-- id:emb embed="true" -->',
      '  - [Gaudi](#g) <!-- id:hop embed="true" -->',
      '    - [Casa Battlo](#cb) <!-- id:o3 embed="true" after="sf" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:sp -->",
      "  - Barcelona <!-- id:bc -->",
      "    - Gaudi <!-- id:g -->",
      "      - Sagrada Familia <!-- id:sf -->",
      "      - Casa Mila <!-- id:cm -->",
      "      - Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Spain
      Barcelona
        Gaudi
          Sagrada Familia
          Casa Battlo
          Casa Mila
  `);
});

test("a broken evidence edge suspends instead of re-aiming", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      '  - [Argument B](#b) <!-- id:o1 embed="true" -->',
      '    - (+) [Beleg B1](#b1) <!-- id:o2 embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Beleg B1 <!-- id:b1 -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(
    `
Note
  Source
    Argument A
    Argument B
      {+} Beleg B1
    Beleg B1
  `,
    { showGutter: true }
  );
});

test("multiselect projected rows can move, be judged, move back, and survive reload", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
      "- Argument D <!-- id:d -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument A" }));
  await userEvent.keyboard("{Shift>}j{/Shift}");
  await expectTargets("Argument A", "Argument B");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument A" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument D" }));

  await expectTree(`
Note
  Source
    Argument C
    Argument D
    Argument A
    Argument B
  `);

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument A" }));
  await userEvent.keyboard("{Shift>}j{/Shift}!");

  await expectTree(
    `
Note
  Source
    Argument C
    Argument D
    {!} Argument A
    {!} Argument B
  `,
    { showGutter: true }
  );

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument A" }));
  await userEvent.keyboard("{Shift>}j{/Shift}");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument A" }));
  setDropIndentLevel("Argument A", "Source", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Source" }));

  await expectTree(
    `
Note
  Source
    {!} Argument A
    {!} Argument B
    Argument C
    Argument D
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#a\)/gu)).toHaveLength(1);
    expect(note.match(/\(#b\)/gu)).toHaveLength(1);
    expect(note).toMatch(
      /\(!\) \[Argument A\]\(#a\) <!-- id:(\S+)[^\n]*\n\s+- \(!\) \[Argument B\]\(#b\)[^\n]*after="\1"/u
    );
  });

  cleanup();
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(
    `
Note
  Source
    {!} Argument A
    {!} Argument B
    Argument C
    Argument D
  `,
    { showGutter: true }
  );
});

test("mixed marked and projected multiselect moves across parents and back", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Parent P <!-- id:p -->",
      "  - Argument A <!-- id:a -->",
      "  - Argument B <!-- id:b -->",
      "- Parent Q <!-- id:q -->",
      "  - Argument C <!-- id:c -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument B" }));
  await userEvent.keyboard("!");
  await userEvent.click(screen.getByRole("treeitem", { name: "Argument A" }));
  await userEvent.keyboard("{Shift>}j{/Shift}");
  await expectTargets("Argument A", "Argument B");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument A" }));
  setDropIndentLevel("Argument A", "Parent Q", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Parent Q" }));

  await expectTree(
    `
Note
  Source
    Parent P
    Parent Q
      Argument A
      {!} Argument B
      Argument C
  `,
    { showGutter: true }
  );

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument A" }));
  await userEvent.keyboard("{Shift>}j{/Shift}");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument A" }));
  setDropIndentLevel("Argument A", "Parent P", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Parent P" }));

  await expectTree(
    `
Note
  Source
    Parent P
      Argument A
      {!} Argument B
    Parent Q
      Argument C
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#a\)/gu)).toHaveLength(1);
    expect(note.match(/\(#b\)/gu)).toHaveLength(1);
    expect(note).toMatch(/\(!\) \[Argument B\]\(#b\)/u);
  });
});

test("moving in one duplicate embed leaves the other placement unchanged", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb1 embed="true" -->',
      '- [S](#src) <!-- id:emb2 embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  fireEvent.dragStart(
    screen.getAllByRole("treeitem", { name: "Argument A" })[0]
  );
  fireEvent.drop(screen.getAllByRole("treeitem", { name: "Argument C" })[0]);

  await expectTree(`
Note
  Source
    Argument B
    Argument C
    Argument A
    [I] Note ↩
  Source
    Argument A
    Argument B
    Argument C
    [I] Note ↩
  `);

  await userEvent.click(
    screen.getAllByRole("treeitem", { name: "Argument A" })[0]
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Note
  Source
    Argument B
    Argument C
    {!} Argument A
    [I] Note ↩
  Source
    Argument A
    Argument B
    Argument C
    [I] Note ↩
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#a\)/gu)).toHaveLength(1);
    expect(note).toMatch(
      /id:emb1 embed="true" -->\n {2}- \(!\) \[Argument A\]\(#a\)[^\n]*after="c"/u
    );
    expect(note).toMatch(/id:emb2 embed="true" -->\s*$/mu);
  });
});

test("mark move move-back remark and repeat-drop stay canonical", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument B" }));
  await userEvent.keyboard("!");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument B" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument C" }));

  await expectTree(
    `
Note
  Source
    Argument A
    Argument C
    {!} Argument B
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument B" }));
  setDropIndentLevel("Argument B", "Source", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Source" }));
  await userEvent.click(screen.getByRole("treeitem", { name: "Argument B" }));
  await userEvent.keyboard("?");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument B" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument A" }));
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Argument B" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument A" }));

  await expectTree(
    `
Note
  Source
    Argument A
    {?} Argument B
    Argument C
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#b\)/gu)).toHaveLength(1);
    expect(note).toMatch(/\(\?\) \[Argument B\]\(#b\)[^\n]*after="a"/u);
  });
});

test("editing judging moving and editing again preserve one source bond", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  const editor = await screen.findByRole("textbox", {
    name: "edit Argument C",
  });
  await userEvent.clear(editor);
  await userEvent.type(editor, "My wording");
  fireEvent.click(screen.getByLabelText("set My wording to relevant"));

  await expectTree(
    `
Note
  Source
    Argument A
    Argument B
    {!} My wording
  `,
    { showGutter: true }
  );

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "My wording" }));
  setDropIndentLevel("My wording", "Source", 3);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Source" }));
  const renamed = await screen.findByRole("textbox", {
    name: "edit My wording",
  });
  await userEvent.clear(renamed);
  await userEvent.type(renamed, "Final wording{Escape}");

  await expectTree(
    `
Note
  Source
    {!} Final wording
    Argument A
    Argument B
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#c\)/gu)).toHaveLength(1);
    expect(note).toMatch(
      /\(!\) Final wording ~~\[Argument C\]\(#c\)~~[^\n]*before="a"/u
    );
  });
});

test("dismiss move and restore keeps one positioned claim", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
      "- Argument C <!-- id:c -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Argument B" }));
  await userEvent.keyboard("x");
  expect(screen.queryByRole("treeitem", { name: "Argument B" })).toBeNull();
  await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
  const dismissed = await screen.findByRole("treeitem", {
    name: "Argument B",
  });
  fireEvent.dragStart(dismissed);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Argument C" }));
  await userEvent.click(screen.getByRole("treeitem", { name: "Argument B" }));
  await userEvent.keyboard("?");
  await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

  await expectTree(
    `
Note
  Source
    Argument A
    Argument C
    {?} Argument B
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#b\)/gu)).toHaveLength(1);
    expect(note).toMatch(/\(\?\) \[Argument B\]\(#b\)[^\n]*after="c"/u);
    expect(note).not.toMatch(/\(x\) \[Argument B\]/u);
  });
});

test("evidence moved away and back preserves the relation without duplicates", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Parent P <!-- id:p -->",
      "  - Evidence <!-- id:e -->",
      "- Parent Q <!-- id:q -->",
    ].join("\n"),
  });

  await userEvent.click(screen.getByRole("treeitem", { name: "Evidence" }));
  await userEvent.keyboard("+");
  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Evidence" }));
  setDropIndentLevel("Evidence", "Parent Q", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Parent Q" }));

  await expectTree(
    `
Note
  Source
    Parent P
      Evidence
    Parent Q
      {+} Evidence
  `,
    { showGutter: true }
  );

  const evidenceRows = screen.getAllByRole("treeitem", { name: "Evidence" });
  fireEvent.dragStart(evidenceRows[1]);
  setDropIndentLevel("Evidence", "Parent P", 4);
  fireEvent.drop(screen.getByRole("treeitem", { name: "Parent P" }));

  await expectTree(
    `
Note
  Source
    Parent P
      {+} Evidence
    Parent Q
  `,
    { showGutter: true }
  );

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note.match(/\(#e\)/gu)).toHaveLength(1);
    expect(note).toMatch(/\(\+\) \[Evidence\]\(#e\)/u);
  });
});

test("dragging Sagrada to the displayed front anchors it before Casa Battlo", async () => {
  const workspacePath = await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Art Noveau](#art) <!-- id:art-placement embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:sagrada-placement embed="true" after="secession-placement" before="otto-placement" -->',
      '  - [Otto Wagner Pavillion](#otto) <!-- id:otto-placement embed="true" from="art-placement" before="spain" parent="art" -->',
      '  - [Casa Mila](#mila) <!-- id:mila-placement embed="true" after="otto-placement" before="spain" parent="art" -->',
      '  - [Casa Battlo](#battlo) <!-- id:battlo-placement embed="true" parent="art" -->',
      '  - [Secession](#secession) <!-- id:secession-placement embed="true" from="art-placement" after="battlo-placement" before="sagrada-placement" parent="art" -->',
      '  - [Barcelona](#barcelona) <!-- id:barcelona-placement embed="true" -->',
    ].join("\n"),
    "art.md": [
      "# Art Noveau <!-- id:art -->",
      "",
      "- Spain <!-- id:spain -->",
      "  - Barcelona <!-- id:barcelona -->",
      "    - Sagrada Familia <!-- id:sf -->",
      "    - Casa Battlo <!-- id:battlo -->",
      "    - Casa Mila <!-- id:mila -->",
      "- Austria <!-- id:austria -->",
      "  - Vienna <!-- id:vienna -->",
      '    - [Architectural Buildings in Austria](#architecture) <!-- id:architecture-placement embed="true" -->',
    ].join("\n"),
    "architecture.md": [
      "# Architectural Buildings in Austria <!-- id:architecture -->",
      "",
      "- Secession <!-- id:secession -->",
      "- Otto Wagner Pavillion <!-- id:otto -->",
    ].join("\n"),
  });

  await expectTree(`
Note
  Art Noveau
    Casa Battlo
    Secession
    Sagrada Familia
    Otto Wagner Pavillion
    Casa Mila
    Spain
      Barcelona
    Austria
      Vienna
        Architectural Buildings in Austria
  `);

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Art Noveau" }));

  await expectTree(`
Note
  Art Noveau
    Sagrada Familia
    Casa Battlo
    Secession
    Otto Wagner Pavillion
    Casa Mila
    Spain
      Barcelona
    Austria
      Vienna
        Architectural Buildings in Austria
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:sagrada-placement embed="true" before="battlo-placement" -->/u
    );
    expect(note).not.toMatch(
      /\[Sagrada Familia\]\(#sf\)[^\n]*before="otto-placement"/u
    );
  });

  cleanup();
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Art Noveau
    Sagrada Familia
    Casa Battlo
    Secession
    Otto Wagner Pavillion
    Casa Mila
    Spain
      Barcelona
    Austria
      Vienna
        Architectural Buildings in Austria
  `);
});

test("position chains longer than ten links resolve completely", async () => {
  const sourceRows = Array.from(
    { length: 15 },
    (_, index) => `- Row ${index} <!-- id:r${index} -->`
  );
  const claims = Array.from(
    { length: 14 },
    (_, index) =>
      `  - [Row ${index}](#r${index}) <!-- id:o${index} embed="true" after="r${
        index + 1
      }" -->`
  );
  await openExpandedWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [S](#src) <!-- id:emb embed="true" -->',
      ...claims,
    ].join("\n"),
    "source.md": ["# Source <!-- id:src -->", "", ...sourceRows].join("\n"),
  });

  await expectTree(`
Note
  Source
${Array.from({ length: 15 }, (_, index) => `    Row ${14 - index}`).join("\n")}
  `);
});

test.each([
  {
    destination: "Spain",
    depth: 4,
    expectedTree: `
Note
  Art Noveau
    Spain
      {~+} Casa Mila (La Pedrera)
      Barcelona
        Gaudi
          {!} Sagrada Familia
          Casa Battlo
  `,
  },
  {
    destination: "Barcelona",
    depth: 5,
    expectedTree: `
Note
  Art Noveau
    Spain
      Barcelona
        {~+} Casa Mila (La Pedrera)
        Gaudi
          {!} Sagrada Familia
          Casa Battlo
  `,
  },
])(
  "moving marked Casa Mila into $destination does not leave its source copy",
  async ({ destination, depth, expectedTree }) => {
    const source = [
      "- Art Noveau <!-- id:art -->",
      "  - Spain <!-- id:sp -->",
      "    - Barcelona <!-- id:bc -->",
      "      - Gaudi <!-- id:g -->",
      "        - (!) Sagrada Familia <!-- id:sf -->",
      "        - Casa Battlo <!-- id:cb -->",
      "        - (+~) Casa Mila (La Pedrera) <!-- id:cm -->",
      "- Austria <!-- id:at -->",
    ].join("\n");
    const workspacePath = writeWorkspace({
      "note.md": "# Note <!-- id:note -->",
      "art.md": source,
    });
    await renderAppTree({
      path: workspacePath,
      initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
    });
    await screen.findByRole("treeitem", { name: "Note" });
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(0, "Art Noveau");
    await openNodeInFullscreen(0, "Art Noveau");
    await navigateToNodeViaSearch(1, "Note");
    await openNodeInFullscreen(1, "Note");

    fireEvent.dragStart(
      getPane(0).getByRole("treeitem", { name: "Art Noveau" })
    );
    fireEvent.drop(getPane(1).getByRole("treeitem", { name: "Note" }));
    await userEvent.click(getPane(0).getByLabelText("Close pane"));
    const [embeddedRoot] = await screen.findAllByRole("treeitem");
    await userEvent.click(embeddedRoot);
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

    fireEvent.dragStart(
      screen.getByRole("treeitem", { name: "Casa Mila (La Pedrera)" })
    );
    setDropIndentLevel("Casa Mila (La Pedrera)", destination, depth);
    fireEvent.drop(screen.getByRole("treeitem", { name: destination }));

    await expectTree(expectedTree, { showGutter: true });
    expect(
      screen.getAllByRole("treeitem", { name: "Casa Mila (La Pedrera)" })
    ).toHaveLength(1);
    await waitFor(() => {
      const persistedSource = fs.readFileSync(
        pathModule.join(workspacePath, "art.md"),
        "utf8"
      );
      expect(
        persistedSource.slice(persistedSource.indexOf("- Art Noveau")).trimEnd()
      ).toBe(source);
      const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
        encoding: "utf8",
      });
      expect(note.match(/\(#cm\)/gu)).toHaveLength(1);
      expect(note).toMatch(
        /- \[Casa Mila \(La Pedrera\)\]\(#cm\)[^\n]*before="\S+" parent="\S+"/u
      );
      expect(note).not.toMatch(/\(\+~\) \[Casa Mila \(La Pedrera\)\]\(#cm\)/u);
    });

    cleanup();
    await renderAppTree({
      path: workspacePath,
      initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
    });
    const [root] = await screen.findAllByRole("treeitem");
    await userEvent.click(root);
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
    await expectTree(expectedTree, { showGutter: true });
  }
);

test("dropping at the front chains onto the previous first claim", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Casa Mila
    Sagrada Familia
    Casa Battlo
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Casa Battlo
    Casa Mila
    Sagrada Familia
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:\S+ embed="true" before="(\S+)" -->\n\s+- \[Casa Mila\]\(#cm\) <!-- id:\1 embed="true" before="sf" -->/u
    );
  });
});

test("dropping after a placed row anchors instead of jumping to the front", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Battlo" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Casa Battlo
    Sagrada Familia
    Casa Mila
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Battlo" }));

  await expectTree(`
Note
  Gaudi
    Casa Battlo
    Casa Mila
    Sagrada Familia
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:(\S+) embed="true" before="sf" -->\n\s+- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" after="\1" before="sf" -->/u
    );
  });
});

test("a drop heals a scope where every claim says first", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:msf embed="true" parent="g" -->',
      '  - [Casa Mila](#cm) <!-- id:mcm embed="true" parent="g" -->',
      '  - [Casa Battlo](#cb) <!-- id:mcb embed="true" parent="g" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Gaudi
    Casa Battlo
    Casa Mila
    Sagrada Familia
  `);

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Casa Battlo
    Casa Mila
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:msf embed="true" before="mcb" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:mcb embed="true" after="msf" before="mcm" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:mcm embed="true" after="mcb" -->/u
    );
  });
});

test("a move re-aims claims in its own embed only", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb1 embed="true" -->',
      '  - [Casa Mila](#cm) <!-- id:p1 embed="true" after="cb" -->',
      '- [Gaudi](#g) <!-- id:emb2 embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:p2 embed="true" after="cb" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Casa Battlo
    Casa Mila
    [I] Note ↩
  Gaudi
    Casa Mila
    Casa Battlo
    Sagrada Familia
    [I] Note ↩
  `);

  fireEvent.dragStart(
    screen.getAllByRole("treeitem", { name: "Casa Battlo" })[0]
  );
  fireEvent.drop(screen.getAllByRole("treeitem", { name: "Gaudi" })[0]);

  await expectTree(`
Note
  Gaudi
    Casa Battlo
    Sagrada Familia
    Casa Mila
    [I] Note ↩
  Gaudi
    Casa Mila
    Casa Battlo
    Sagrada Familia
    [I] Note ↩
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:p1 embed="true" after="sf" -->/u
    );
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:p2 embed="true" after="cb" -->/u
    );
  });
});

test("a drop into the middle of a chain re-anchors only the displaced link", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:msf embed="true" parent="g" -->',
      '  - [Casa Mila](#cm) <!-- id:mcm embed="true" after="sf" -->',
      '  - [Casa Battlo](#cb) <!-- id:mcb embed="true" after="cm" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
      "- Park Guell <!-- id:pg -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Casa Mila
    Casa Battlo
    Park Guell
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Park Guell" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Sagrada Familia" }));

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Park Guell
    Casa Mila
    Casa Battlo
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:msf embed="true" parent="g" -->/u
    );
    expect(note).toMatch(
      /- \[Park Guell\]\(#pg\) <!-- id:(\S+) embed="true" after="msf" before="mcm" -->\n\s+- \[Casa Mila\]\(#cm\) <!-- id:mcm embed="true" after="\1" before="mcb" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:mcb embed="true" after="cm" -->/u
    );
  });
});

test("dragging the first row away restamps its dependent", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
      '  - [Sagrada Familia](#sf) <!-- id:msf embed="true" parent="g" -->',
      '  - [Casa Mila](#cm) <!-- id:mcm embed="true" after="sf" -->',
      '  - [Casa Battlo](#cb) <!-- id:mcb embed="true" after="cm" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Casa Battlo" }));

  await expectTree(`
Note
  Gaudi
    Casa Mila
    Casa Battlo
    Sagrada Familia
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:mcm embed="true" before="mcb" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:mcb embed="true" after="cm" -->/u
    );
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:msf embed="true" after="mcb" -->/u
    );
  });
});

test("dropping a row where it already sits changes nothing", async () => {
  const noteContent = [
    "# Note <!-- id:note -->",
    "",
    '- [Gaudi](#g) <!-- id:emb embed="true" -->',
    '  - [Sagrada Familia](#sf) <!-- id:msf embed="true" before="mcm" -->',
    '  - [Casa Mila](#cm) <!-- id:mcm embed="true" after="msf" before="cb" -->',
  ].join("\n");
  const workspacePath = writeWorkspace({
    "note.md": noteContent,
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Casa Mila
    Casa Battlo
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Sagrada Familia" }));

  await expectTree(`
Note
  Gaudi
    Sagrada Familia
    Casa Mila
    Casa Battlo
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    const body = note.slice(note.indexOf("# Note"));
    expect(body.trimEnd()).toBe(noteContent.trimEnd());
  });
});

test("a drop breaks a mutual anchor cycle", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
      '  - [Casa Mila](#cm) <!-- id:mcm embed="true" after="cb" -->',
      '  - [Casa Battlo](#cb) <!-- id:mcb embed="true" after="cm" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Casa Mila
    Sagrada Familia
    Casa Battlo
  `);

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:mcm embed="true" before="sf" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Battlo\]\(#cb\) <!-- id:mcb embed="true" after="sf" -->/u
    );
  });
});

test("an unrelated drop never rewrites a dangling anchor", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
      '  - [Casa Mila](#cm) <!-- id:mcm embed="true" after="ghost" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(
    screen.getByRole("treeitem", { name: "Sagrada Familia" })
  );
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \[Sagrada Familia\]\(#sf\) <!-- id:\S+ embed="true" before="mcm" -->/u
    );
    expect(note).toMatch(
      /- \[Casa Mila\]\(#cm\) <!-- id:mcm embed="true" after="ghost" -->/u
    );
  });
});

test("marking a moved row keeps its place", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Gaudi](#g) <!-- id:emb embed="true" -->',
    ].join("\n"),
    "gaudi.md": [
      "# Gaudi <!-- id:g -->",
      "",
      "- Sagrada Familia <!-- id:sf -->",
      "- Casa Mila <!-- id:cm -->",
      "- Casa Battlo <!-- id:cb -->",
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "note.md"),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Gaudi" }));

  await expectTree(`
Note
  Gaudi
    Casa Mila
    Sagrada Familia
    Casa Battlo
  `);

  await userEvent.click(screen.getByRole("treeitem", { name: "Casa Mila" }));
  fireEvent.click(screen.getByLabelText("set Casa Mila to relevant"));

  await waitFor(() => {
    const note = fs.readFileSync(pathModule.join(workspacePath, "note.md"), {
      encoding: "utf8",
    });
    expect(note).toMatch(
      /- \(!\) \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" before="sf" -->/u
    );
    expect(note.match(/\[Casa Mila\]/gu)).toHaveLength(1);
  });

  await expectTree(
    `
Note
  Gaudi
    {!} Casa Mila
    Sagrada Familia
    Casa Battlo
  `,
    { showGutter: true }
  );
});

test("an embed row opens as a pane root and projects there", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Source Document{Enter}{Tab}Source{Enter}{Tab}Descendant{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Target Document{Enter}{Tab}Target{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Source");
  await openNodeInFullscreen(0, "Source");
  await navigateToNodeViaSearch(1, "Target");
  await openNodeInFullscreen(1, "Target");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Source" }));
  fireEvent.drop(getPane(1).getByRole("treeitem", { name: "Target" }));

  await getPane(1).findByLabelText("expand Source");
  await userEvent.click(getPane(1).getByLabelText("open Source in fullscreen"));

  await expectTree(`
Source
  Descendant
  [I] Target Document / Target ↩
Source
  Descendant
  `);
});

test("dragging from another user's document records knowstr_sources", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  const { relayPool: aliceRelayPool } = renderApp(alice());
  await type(
    "Holidays{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );
  const aliceDocId = await waitFor(() => {
    const content = aliceRelayPool
      .getDecryptedEvents()
      .filter(
        (event) =>
          event.kind === KIND_KNOWLEDGE_DOCUMENT &&
          event.content.includes("- Holidays")
      )
      .at(-1)?.content;
    const docId = content?.match(/knowstr_doc_id: (\S+)/u)?.[1];
    if (!docId) {
      throw new Error("Missing Alice's document id");
    }
    return docId;
  });
  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "Holidays",
    "Cities"
  );
  cleanup();

  const { relayPool } = renderApp({
    ...bob(),
    initialRoute: nodeUrl,
    storageRelays: ["wss://ambient-storage.example/"],
  });

  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);

  await userEvent.click(screen.getByLabelText("Open new pane"));
  await type("Mine{Escape}");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Paris" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Mine" }));

  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
Mine
  Paris
  `);

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "London" }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Mine" }));

  const aliceNpub = nip19.npubEncode(requireUser(alice()).publicKey);
  await waitFor(() => {
    const bobDoc = relayPool
      .getDecryptedEvents()
      .filter(
        (event) =>
          event.kind === KIND_KNOWLEDGE_DOCUMENT &&
          event.content.includes("- Mine") &&
          event.content.includes("London")
      )
      .at(-1)?.content;
    if (!bobDoc) {
      throw new Error("Missing Bob's document event");
    }
    expect(bobDoc).toContain("knowstr_sources:");
    expect(bobDoc).toContain(`author: ${aliceNpub}`);
    expect(bobDoc).toContain(`doc: ${aliceDocId}`);
    expect(bobDoc.match(/author: /gu)).toHaveLength(1);
  });
});

test("mutual embeds keep the reciprocal arrow and terminate composition", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Source Document{Enter}{Tab}Source{Enter}{Tab}Descendant{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Target Document{Enter}{Tab}Target{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Source");
  await openNodeInFullscreen(0, "Source");
  await navigateToNodeViaSearch(1, "Target");
  await openNodeInFullscreen(1, "Target");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Source" }));
  fireEvent.drop(getPane(1).getByRole("treeitem", { name: "Target" }));
  await getPane(1).findByLabelText("expand Source");

  fireEvent.dragStart(getPane(1).getByRole("treeitem", { name: "Target" }));
  fireEvent.drop(getPane(0).getByRole("treeitem", { name: "Source" }));
  await getPane(0).findByLabelText("expand Target");

  const [pane1Root] = getPane(1).getAllByRole("treeitem");
  await userEvent.click(pane1Root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
Source
  Target↩
  Descendant
Target
  Source↩
    Target↩
    Descendant
  `);
});
