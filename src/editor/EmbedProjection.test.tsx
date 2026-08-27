import fs from "fs";
import os from "os";
import pathModule from "path";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

test("a user's own line below an embed appears after the projected rows", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Old Label](#src) <!-- id:emb embed="true" -->',
      "  - My own note <!-- id:own -->",
    ].join("\n"),
    "source.md": [
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
      "- Argument B <!-- id:b -->",
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
    Argument B
    My own note
  `);
});

test("a line below an embed cannot reopen the source the embed shows", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      '# [Source](#src) <!-- id:emb embed="true" -->',
      "",
      '- [Source again](#src) <!-- id:again embed="true" -->',
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

  await expectTree(`
Source
  Argument A
  Source again
  `);
});

test("the second placement of a source is a childless link", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [First](#src) <!-- id:e1 embed="true" -->',
      '- [Second](#src) <!-- id:e2 embed="true" -->',
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

  await expectTree(`
Note
  Source
    Argument A
    [I] Note ↩
  Second
  `);

  await userEvent.click(screen.getByLabelText("collapse Source"));

  await expectTree(`
Note
  Source
  Second
  `);
});

test("incoming references reach a chain embed's footer", async () => {
  const workspacePath = writeWorkspace({
    "note.md": '# [Outer](#head) <!-- id:o embed="true" -->',
    "source.md": [
      '# [Head](#src) <!-- id:head embed="true" -->',
      "",
      "# Source <!-- id:src -->",
      "",
      "- Argument A <!-- id:a -->",
    ].join("\n"),
    "other.md": [
      "# Other Doc <!-- id:oth -->",
      "",
      "- Points at [head](#head) <!-- id:p -->",
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
Source
  Argument A
  [I] Other Doc / Points at head ↩
  `);
});

test("the in-progress editor row appears below an embed", async () => {
  const workspacePath = writeWorkspace({
    "note.md": [
      "# Note <!-- id:note -->",
      "",
      '- [Old Label](#src) <!-- id:emb embed="true" -->',
      "  - My own note <!-- id:own -->",
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

  await userEvent.click(await screen.findByLabelText("edit My own note"));
  await userEvent.keyboard("{Enter}");

  await expectTree(`
Note
  Source
    Argument A
    My own note
    [NEW NODE]
  `);
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

  expect(
    getPane(0).getByRole("textbox", { name: "edit Descendant" })
  ).toBeDefined();
  expect(
    getPane(1).queryByRole("textbox", { name: "edit Descendant" })
  ).toBeNull();
  expect(getPane(1).queryByRole("textbox", { name: "edit Source" })).toBeNull();

  await userEvent.click(
    getPane(1).getByRole("treeitem", { name: "Descendant" })
  );
  await userEvent.keyboard("!");
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

const CONTEXT_FILES = {
  "shared.md": ["# Shared <!-- id:sh -->", "", "- Insight <!-- id:i1 -->"].join(
    "\n"
  ),
  "b.md": [
    "# B <!-- id:b -->",
    "",
    '- [Shared](#sh) <!-- id:bs embed="true" -->',
  ].join("\n"),
  "c.md": [
    "# C <!-- id:c -->",
    "",
    '- [Shared](#sh) <!-- id:cs embed="true" -->',
  ].join("\n"),
};

test("which copy shows whole depends on the composed view", async () => {
  const workspacePath = writeWorkspace({
    ...CONTEXT_FILES,
    "a.md": [
      "# A <!-- id:a -->",
      "",
      '- [B](#b) <!-- id:ab embed="true" -->',
      '- [C](#c) <!-- id:ac embed="true" -->',
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "c.md"),
  });
  const [cRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(cRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
C
  Shared
    Insight
    [I] B ↩
  [I] A ↩
  `);

  cleanup();
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "a.md"),
  });
  const [aRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(aRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
A
  B
    Shared
      Insight
      [I] C ↩
  C
    Shared
  `);
});

test("opening a demoted link shows its target whole with that placement's diff", async () => {
  const workspacePath = writeWorkspace({
    ...CONTEXT_FILES,
    "c.md": [
      "# C <!-- id:c -->",
      "",
      '- [Shared](#sh) <!-- id:cs embed="true" -->',
      "  - My note <!-- id:cn -->",
    ].join("\n"),
    "a.md": [
      "# A <!-- id:a -->",
      "",
      '- [B](#b) <!-- id:ab embed="true" -->',
      '- [C](#c) <!-- id:ac embed="true" -->',
    ].join("\n"),
  });

  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "a.md"),
  });
  const [aRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(aRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await screen.findByRole("treeitem", { name: "C" });

  await expectTree(`
A
  B
    Shared
      Insight
      [I] C ↩
  C
    Shared
      My note
  `);

  const demoted = screen
    .getAllByRole("treeitem", { name: "Shared" })
    .flatMap((item) =>
      within(item).queryAllByRole("link", { name: "Navigate to Shared" })
    )
    .at(-1);
  if (!demoted) {
    throw new Error("Missing demoted link");
  }
  await userEvent.click(demoted);

  await expectTree(`
Shared
  Insight
  My note
  [I] B ↩
  `);
});

test("reordering the routes flips which copy shows whole", async () => {
  const reordered = writeWorkspace({
    ...CONTEXT_FILES,
    "a.md": [
      "# A <!-- id:a -->",
      "",
      '- [C](#c) <!-- id:ac embed="true" -->',
      '- [B](#b) <!-- id:ab embed="true" -->',
    ].join("\n"),
  });

  await renderAppTree({
    path: reordered,
    initialRoute: buildDocumentRouteUrl(LOCAL, "a.md"),
  });
  const [aRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(aRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

  await expectTree(`
A
  C
    Shared
      Insight
      [I] B ↩
  B
    Shared
  `);
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
