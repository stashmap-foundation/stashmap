import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "../nostr";
import { clickRow } from "./Multiselect.testUtils";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderApp,
  setup,
  type,
} from "../utils.test";

afterEach(cleanup);

test("REPRO: drag-fork of a child, drift on both sides, expect versions", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Architecture{Enter}{Tab}Art Nouveau{Enter}{Tab}Barcelona{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("My Hobbies{Escape}");

  // Two panes: Architecture left, My Hobbies right; plain drag across
  // panes deep-copies with lineage.
  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Architecture");

  const hobbyItems = screen.getAllByRole("treeitem", { name: "My Hobbies" });
  const hobbiesInPane1 = hobbyItems[hobbyItems.length - 1];
  fireEvent.dragStart(screen.getAllByText("Art Nouveau")[0]);
  fireEvent.dragOver(hobbiesInPane1);
  fireEvent.drop(hobbiesInPane1);

  await expectTree(`
Architecture
  Art Nouveau
    Barcelona
My Hobbies
  Art Nouveau
    Barcelona
  `);

  // Drift on the fork side (pane 1) …
  const forkEditors = screen.getAllByLabelText("edit Art Nouveau");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Enter}{Tab}Vienna{Escape}");

  // …and on the original (navigate pane 0 back to Architecture).
  await navigateToNodeViaSearch(0, "Architecture");
  await userEvent.click(screen.getAllByLabelText("edit Art Nouveau")[0]);
  await userEvent.keyboard("{Enter}{Tab}Paris{Escape}");

  await expectTree(`
Architecture
  Art Nouveau
    Paris
    Barcelona
    [S] Vienna
My Hobbies
  Art Nouveau
    Vienna
    Barcelona
    [S] Paris
  `);

  // The leak is closed: snapshots go on the wire as encrypted envelopes
  // under the forking document's storage key, never as plaintext.
  const wireSnapshots = alice()
    .relayPool.getEvents()
    .filter((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT);
  expect(wireSnapshots.length).toBeGreaterThan(0);
  wireSnapshots.forEach((event) => {
    const envelope = JSON.parse(event.content) as {
      key?: string;
      data?: string;
    };
    expect(typeof envelope.key).toBe("string");
    expect(typeof envelope.data).toBe("string");
  });
});

test("CP4.1: renames cross the fork edge as strikethrough suggestion rows", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Architecture{Enter}{Tab}Art Nouveau{Enter}{Tab}Barcelona{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("My Hobbies{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Architecture");

  const hobbyItems = screen.getAllByRole("treeitem", { name: "My Hobbies" });
  fireEvent.dragStart(screen.getAllByText("Art Nouveau")[0]);
  fireEvent.dragOver(hobbyItems[hobbyItems.length - 1]);
  fireEvent.drop(hobbyItems[hobbyItems.length - 1]);

  // Rename the ORIGINAL Art Nouveau (pane 0).
  await userEvent.click(screen.getAllByLabelText("edit Art Nouveau")[0]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  // The fork's expansion shows the rename suggestion: my text on the
  // way out (strikethrough), theirs beside it.
  await expectTree(`
Architecture
  Jugendstil
    Barcelona
My Hobbies
  Art Nouveau
    Barcelona
    [S] Art Nouveau Jugendstil
  `);

  // The original also grows a child: the fork sees it as an addition
  // suggestion alongside the rename.
  await userEvent.click(screen.getAllByLabelText("edit Jugendstil")[0]);
  await userEvent.keyboard("{Enter}{Tab}Brussels{Escape}");
  await expectTree(`
Architecture
  Jugendstil
    Brussels
    Barcelona
My Hobbies
  Art Nouveau
    Barcelona
    [S] Brussels
    [S] Art Nouveau Jugendstil
  `);

  // Dismiss with x: dismissal advances the edge to a CONSTRUCTED baseline
  // (old children, their text), so exactly that version's text is muted —
  // the child suggestion keeps running against the old children, and
  // nothing changes on the original's side of the edge.
  await clickRow("Art Nouveau Jugendstil");
  await userEvent.keyboard("x");
  await expectTree(`
Architecture
  Jugendstil
    Brussels
    Barcelona
My Hobbies
  Art Nouveau
    Barcelona
    [S] Brussels
  `);
});

test("CP4.1: taking the rename replaces my text with theirs", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Architecture{Enter}{Tab}Art Nouveau{Enter}{Tab}Barcelona{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("My Hobbies{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Architecture");

  const hobbyItems = screen.getAllByRole("treeitem", { name: "My Hobbies" });
  fireEvent.dragStart(screen.getAllByText("Art Nouveau")[0]);
  fireEvent.dragOver(hobbyItems[hobbyItems.length - 1]);
  fireEvent.drop(hobbyItems[hobbyItems.length - 1]);

  await userEvent.click(screen.getAllByLabelText("edit Art Nouveau")[0]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  // Take: any non-x judgment on the rename row adopts their text.
  await clickRow("Art Nouveau Jugendstil");
  await userEvent.keyboard("!");
  await expectTree(`
Architecture
  Jugendstil
    Barcelona
My Hobbies
  Jugendstil
    Barcelona
  `);
});

test("REPRO: unchanged fork shows nothing anywhere; fork rename shows on original", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Architecture{Enter}{Tab}Art Nouveau{Enter}{Tab}Barcelona{Enter}Brussels{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("My Hobbies{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Architecture");

  const hobbyItems = screen.getAllByRole("treeitem", { name: "My Hobbies" });
  fireEvent.dragStart(screen.getAllByText("Art Nouveau")[0]);
  fireEvent.dragOver(hobbyItems[hobbyItems.length - 1]);
  fireEvent.drop(hobbyItems[hobbyItems.length - 1]);

  // Untouched fork: silent on both sides — no adds, no rename row.
  await expectTree(`
Architecture
  Art Nouveau
    Barcelona
    Brussels
My Hobbies
  Art Nouveau
    Barcelona
    Brussels
  `);

  // Rename the FORK (pane 1): the ORIGINAL sees the rename suggestion.
  const forkEditors = screen.getAllByLabelText("edit Art Nouveau");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  await expectTree(`
Architecture
  Art Nouveau
    Barcelona
    Brussels
    [S] Art Nouveau Jugendstil
My Hobbies
  Jugendstil
    Barcelona
    Brussels
  `);
});

test("REPRO exact: three children, drag into freshly written doc", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Styles I like{Enter}{Tab}Art Noveau{Enter}{Tab}Vienna{Enter}Barcelona{Enter}Gaudi{Escape}"
  );

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(screen.getAllByLabelText("Create new note")[1]);
  await type("Architecture{Escape}");

  const archItems = screen.getAllByRole("treeitem", { name: "Architecture" });
  fireEvent.dragStart(screen.getAllByText("Art Noveau")[0]);
  fireEvent.dragOver(archItems[archItems.length - 1]);
  fireEvent.drop(archItems[archItems.length - 1]);

  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
Architecture
  Art Noveau
    Vienna
    Barcelona
    Gaudi
  `);

  const forkEditors = screen.getAllByLabelText("edit Art Noveau");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
    [S] Art Noveau Jugendstil
Architecture
  Jugendstil
    Vienna
    Barcelona
    Gaudi
  `);
});

test("REPRO exact: drag while the new doc's editor is still open", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Styles I like{Enter}{Tab}Art Noveau{Enter}{Tab}Vienna{Enter}Barcelona{Enter}Gaudi{Escape}"
  );

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(screen.getAllByLabelText("Create new note")[1]);
  await type("Architecture");

  const archItems = screen.getAllByRole("treeitem", { name: "Architecture" });
  fireEvent.dragStart(screen.getAllByText("Art Noveau")[0]);
  fireEvent.dragOver(archItems[archItems.length - 1]);
  fireEvent.drop(archItems[archItems.length - 1]);

  // The drop replaced the unsaved doc: pane 1 became a doc-root fork.
  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
Art Noveau
  Vienna
  Barcelona
  Gaudi
  `);

  // KNOWN GAP (pinned): the drop did not fork — pane 1 opened the SAME
  // node, so renaming through pane 1 renames the original silently.
  // Whether drop-on-unsaved-doc should open-in-place or fork is a design
  // call; this pins today's behavior so a change is deliberate.
  const forkEditors = screen.getAllByLabelText("edit Art Noveau");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  await expectTree(`
Styles I like
  Jugendstil
    Vienna
    Barcelona
    Gaudi
Jugendstil
  Vienna
  Barcelona
  Gaudi
  `);
});

test("REPRO exact: Architecture{Enter} leaves an empty bullet, then drag", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Styles I like{Enter}{Tab}Art Noveau{Enter}{Tab}Vienna{Enter}Barcelona{Enter}Gaudi{Escape}"
  );

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(screen.getAllByLabelText("Create new note")[1]);
  await type("Architecture{Enter}{Tab}");

  const archItems = screen.getAllByRole("treeitem", { name: "Architecture" });
  fireEvent.dragStart(screen.getAllByText("Art Noveau")[0]);
  fireEvent.dragOver(archItems[archItems.length - 1]);
  fireEvent.drop(archItems[archItems.length - 1]);

  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
Architecture
  [NEW NODE]
  Art Noveau
    Vienna
    Barcelona
    Gaudi
  `);
});

test("REPRO exact: source doc from a previous session (reload), then drag", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Styles I like{Enter}{Tab}Art Noveau{Enter}{Tab}Vienna{Enter}Barcelona{Enter}Gaudi{Escape}"
  );
  cleanup();

  // Fresh session: the note comes from storage, not from this session's
  // in-memory graph.
  window.history.pushState({}, "", "/");
  renderApp(alice());
  await navigateToNodeViaSearch(0, "Styles I like");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(screen.getAllByLabelText("Create new note")[1]);
  await type("Architecture{Escape}");

  const archItems = screen.getAllByRole("treeitem", { name: "Architecture" });
  fireEvent.dragStart(screen.getAllByText("Art Noveau")[0]);
  fireEvent.dragOver(archItems[archItems.length - 1]);
  fireEvent.drop(archItems[archItems.length - 1]);

  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
Architecture
  Art Noveau
    Vienna
    Barcelona
    Gaudi
  `);

  const forkEditors = screen.getAllByLabelText("edit Art Noveau");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Control>}a{/Control}Jugendstil{Escape}");

  await expectTree(`
Styles I like
  Art Noveau
    Vienna
    Barcelona
    Gaudi
    [S] Art Noveau Jugendstil
Architecture
  Jugendstil
    Vienna
    Barcelona
    Gaudi
  `);
});

test("REPRO chain: fork of a fork — middle pane grows phantom adds", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  // Pane 0, doc A: Jugendstil root with three children.
  await type(
    "Jugendstil{Enter}{Tab}Barcelona{Enter}Vienna{Enter}Gaudi{Escape}"
  );

  // Doc B in pane 1.
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Styles I like{Escape}");
  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Jugendstil");

  // First fork: drag the Jugendstil root into pane 1.
  const stylesItems = screen.getAllByRole("treeitem", {
    name: "Styles I like",
  });
  fireEvent.dragStart(
    screen.getAllByRole("treeitem", { name: "Jugendstil" })[0]
  );
  fireEvent.dragOver(stylesItems[stylesItems.length - 1]);
  fireEvent.drop(stylesItems[stylesItems.length - 1]);

  // Expand the fork, rename it, kick out ITS Vienna.
  const forkToggles = screen.getAllByLabelText("expand Jugendstil");
  await userEvent.click(forkToggles[forkToggles.length - 1]);
  const forkEditors = screen.getAllByLabelText("edit Jugendstil");
  await userEvent.click(forkEditors[forkEditors.length - 1]);
  await userEvent.keyboard("{Control>}a{/Control}Catalan Modernisme{Escape}");
  const viennaEditors = screen.getAllByLabelText("edit Vienna");
  await userEvent.click(viennaEditors[viennaEditors.length - 1]);
  await userEvent.keyboard("{Escape}{Delete}");

  // The first edge works: the original sees the rename (and Vienna's
  // absence is deletion-protected, not resuggested).
  await expectTree(`
Jugendstil
  Barcelona
  Vienna
  Gaudi
  [V] -1
  [S] Jugendstil Catalan Modernisme
Styles I like
  Catalan Modernisme
    Barcelona
    Gaudi
  `);

  // Doc C in pane 0: Barcelona > Architecture.
  await userEvent.click(screen.getAllByLabelText("Create new note")[0]);
  await type("Barcelona Doc{Enter}{Tab}Architecture{Escape}");

  // Second fork: drag Catalan Modernisme (pane 1) onto Architecture.
  const archItems = screen.getAllByRole("treeitem", { name: "Architecture" });
  fireEvent.dragStart(screen.getAllByText("Catalan Modernisme")[0]);
  fireEvent.dragOver(archItems[archItems.length - 1]);
  fireEvent.drop(archItems[archItems.length - 1]);

  // The chain fork must not create phantom adds in the middle.
  await expectTree(`
Barcelona Doc
  Architecture
  Catalan Modernisme
    Barcelona
    Gaudi
Styles I like
  Catalan Modernisme
    Barcelona
    Gaudi
  `);

  // Rename the grandchild fork: the MIDDLE sees the rename row (its
  // edge), the grandparent does not (skip-generation, J2 — hop by hop).
  const cEditors = screen.getAllByLabelText("edit Catalan Modernisme");
  await userEvent.click(cEditors[0]);
  await userEvent.keyboard("{Control>}a{/Control}Modernisme{Escape}");

  await expectTree(`
Barcelona Doc
  Architecture
  Modernisme
    Barcelona
    Gaudi
Styles I like
  Catalan Modernisme
    Barcelona
    Gaudi
    [S] Catalan Modernisme Modernisme
  `);
});
