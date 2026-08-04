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

test("a dragged row becomes a readonly embed that projects in a drill-down surface", async () => {
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
      /- \[Gaudi\]\(#g\) <!-- id:\S+ embed="true" -->\n {4}- \[Casa Battlo\]\(#cb\) <!-- id:\S+ embed="true" front="true" -->/u
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
      /- \[Barcelona\]\(#bc\) <!-- id:\S+ embed="true" -->\n {4}- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" front="true" -->/u
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
      /- My own row <!-- id:own -->\n- \[Casa Mila\]\(#cm\) <!-- id:\S+ embed="true" -->/u
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
      /- \[A\]\(#art\) <!-- id:emb embed="true" -->\n- My own row <!-- id:own -->\n- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:\S+ embed="true" -->/u
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
      /- \(!\) \[Barcelona\]\(#bc\) <!-- id:bcc embed="true" -->\n {6}- \[Gaudi\]\(#g\) <!-- id:\S+ embed="true" -->\n {8}- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:moved embed="true" front="true" -->/u
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
      /- \(!\) \[Sagrada Familia\]\(#sf\) <!-- id:moved embed="true" after="cm" -->/u
    );
    expect(note).not.toMatch(/^ {2}- \(!\) \[Sagrada Familia\]/mu);
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

test("a move to the root with a dead anchor suspends whole", async () => {
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
