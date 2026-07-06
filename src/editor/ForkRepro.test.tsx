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
