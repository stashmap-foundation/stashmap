import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nip19 } from "nostr-tools";
import {
  ALICE,
  BOB,
  ANON,
  setup,
  renderApp,
  findNewNodeEditor,
  type,
  expectTree,
  readonlyRoute,
  requireUser,
} from "./utils.test";
import { defaultPane } from "./userSessionState";

test("App defaults to empty pane with new node editor when visiting /", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  await screen.findByLabelText("new node editor", undefined, {
    timeout: 5000,
  });
});

test("Navigate to specific node via local typed URL", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());
  await type("Test Node{Escape}");
  const nodeId =
    screen
      .getByRole("treeitem", { name: "Test Node" })
      .getAttribute("data-node-id") ?? "";
  expect(nodeId).not.toBe("");
  cleanup();

  renderApp({
    ...alice(),
    initialRoute: `/local/n/${encodeURIComponent(nodeId)}`,
  });

  await screen.findByRole("treeitem", { name: "Test Node" });
});

test("Fork works when navigating to a version entry", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Enter}Rome{Enter}Vienna{Escape}"
  );
  cleanup();

  renderApp({
    ...bob(),
    initialRoute: readonlyRoute(
      requireUser(alice()).publicKey,
      "My Notes",
      "Cities"
    ),
  });
  await screen.findByText("READONLY");
  await userEvent.click(await screen.findByLabelText("copy root to edit"));

  await userEvent.click(await screen.findByLabelText("edit Cities"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Berlin{Escape}");

  await expectTree(`
Cities
  Berlin
  Paris
  London
  Rome
  Vienna
  `);
});

test("Bob can view Alice's node via storage URL without following her", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...bob(), initialRoute: nodeUrl });

  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);
});

test("Anonymous user can view node via storage URL", async () => {
  const [alice, anon] = setup([ALICE, ANON]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...anon(), initialRoute: nodeUrl });

  await expectTree(`
Cities
  Paris
  London
  `);
});

test("Anonymous user sees versioned node text via storage URL", async () => {
  const [alice, anon] = setup([ALICE, ANON]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Barcelona{Enter}London{Escape}"
  );

  const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
  await userEvent.click(barcelonaEditor);
  await userEvent.clear(barcelonaEditor);
  await userEvent.type(barcelonaEditor, "BCN{Escape}");

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...anon(), initialRoute: nodeUrl });

  await expectTree(`
Cities
  BCN
  London
  `);
});

test("Clicking breadcrumb while viewing other user's content preserves READONLY", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...bob(), initialRoute: nodeUrl });

  await screen.findByText("READONLY");
  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);

  await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

  await screen.findByText("READONLY");
  await userEvent.click(await screen.findByLabelText("expand Cities"));
  await expectTree(`
[O] My Notes
  [O] Cities
    [O] Paris
    [O] London
  `);
});

test("Opening typed storage route shows READONLY", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );
  cleanup();

  renderApp({
    ...bob(),
    initialRoute: readonlyRoute(
      requireUser(alice()).publicKey,
      "My Notes",
      "Cities"
    ),
  });

  await screen.findByText("READONLY");
  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);
});

test("Breadcrumb navigation opens document URLs for document roots", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...bob(), initialRoute: nodeUrl });

  await screen.findByText("READONLY");

  await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/storage\//);
  });
  await screen.findByText("READONLY");
});

test("Clicking fullscreen while viewing other user's content preserves READONLY", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  renderApp({ ...bob(), initialRoute: nodeUrl });

  await screen.findByText("READONLY");
  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);

  await userEvent.click(
    await screen.findByLabelText("open Paris in fullscreen")
  );

  await screen.findByText("READONLY");
  await expectTree(`
[O] Paris
  `);
});

test("Relay filters never contain invalid pubkeys when anonymous user views storage URL", async () => {
  const [alice, anon] = setup([ALICE, ANON]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  const { relayPool } = renderApp({ ...anon(), initialRoute: nodeUrl });

  await expectTree(`
Cities
  Paris
  London
  `);

  const allFilters = relayPool.getSubscriptions().flatMap((s) => s.filters);
  const allAuthors = allFilters.flatMap((f) => f.authors ?? []);
  allAuthors.forEach((author) => {
    expect(author).toMatch(/^[0-9a-f]{64}$/);
  });
});

test("typed URL takes priority over stale history state", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  const nodeUrl = readonlyRoute(
    requireUser(alice()).publicKey,
    "My Notes",
    "Cities"
  );
  cleanup();

  const stalePanes = [
    { ...defaultPane(), sourceId: requireUser(bob()).publicKey },
  ];
  const origPushState = window.history.pushState.bind(window.history);
  jest
    .spyOn(window.history, "pushState")
    .mockImplementation(
      (_data: unknown, title: string, url?: string | URL | null) => {
        origPushState({ panes: stalePanes }, title, url);
      }
    );

  renderApp({ ...bob(), initialRoute: nodeUrl });

  jest.restoreAllMocks();

  await expectTree(`
[O] Cities
  [O] Paris
  [O] London
  `);
});

test("Same URL renders editable workspace for owner and read-only panes for others", async () => {
  const [alice, bob, anon] = setup([ALICE, BOB, ANON]);

  renderApp(alice());
  await type("My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Escape}");

  const ownerNpub = nip19.npubEncode(requireUser(alice()).publicKey);
  const sharedUrl = readonlyRoute(ownerNpub, "My Notes", "Cities");
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp({ ...alice(), initialRoute: sharedUrl });
  await expectTree(`
Cities
  Paris
  `);
  expect(screen.queryByText("READONLY")).toBeNull();
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp({ ...bob(), initialRoute: sharedUrl });
  await screen.findByText("READONLY");
  await expectTree(`
[O] Cities
  [O] Paris
  `);
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp({ ...anon(), initialRoute: sharedUrl });
  await screen.findByText("READONLY");
  await expectTree(`
[O] Cities
  [O] Paris
  `);
});

test("Own storage route renders editable for owner", async () => {
  const [alice] = setup([ALICE]);

  renderApp(alice());
  await type("My Notes{Enter}{Tab}Cities{Escape}");

  const ownerNpub = nip19.npubEncode(requireUser(alice()).publicKey);
  const sharedUrl = readonlyRoute(ownerNpub, "My Notes", "Cities");
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp({ ...alice(), initialRoute: sharedUrl });
  await expectTree(`
Cities
  `);

  expect(screen.queryByText("READONLY")).toBeNull();
});
