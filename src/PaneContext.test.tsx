import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  ANON,
  setup,
  renderApp,
  setupTestDB,
  findNodeByText,
  type,
  expectTree,
} from "./utils.test";

test("App defaults to empty pane with new node editor when visiting /", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  await screen.findByLabelText("new node editor", undefined, {
    timeout: 5000,
  });
});

test("Navigate to specific node via URL using human-readable path", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Test Node", []]]);

  const testNode = findNodeByText(db, "Test Node");
  expect(testNode).toBeDefined();

  renderApp({
    ...alice(),
    initialRoute: `/n/${encodeURIComponent("Test Node")}`,
  });

  await screen.findByRole("treeitem", { name: "Test Node" });
});

test("Bob can view Alice's relation via /r/ URL without following her", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await expectTree(`
Cities
  Paris
  London
  `);

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...bob(), initialRoute: relationUrl });

  await expectTree(`
Cities
  Paris
  London
  `);
});

test("Anonymous user can view relation via /r/ URL", async () => {
  const [alice, anon] = setup([ALICE, ANON]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await expectTree(`
Cities
  Paris
  London
  `);

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...anon(), initialRoute: relationUrl });

  await expectTree(`
Cities
  Paris
  London
  `);
});

test("Anonymous user sees versioned node text via /r/ URL", async () => {
  const [alice, anon] = setup([ALICE, ANON]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Barcelona{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Barcelona
    London
  `);

  const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
  await userEvent.click(barcelonaEditor);
  await userEvent.clear(barcelonaEditor);
  await userEvent.type(barcelonaEditor, "BCN{Escape}");

  await expectTree(`
My Notes
  Cities
    BCN
    London
  `);

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await expectTree(`
Cities
  BCN
  London
  `);

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...anon(), initialRoute: relationUrl });

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

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...bob(), initialRoute: relationUrl });

  await screen.findByText("READONLY");
  await expectTree(`
Cities
  Paris
  London
  `);

  await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

  await screen.findByText("READONLY");
  await userEvent.click(await screen.findByLabelText("expand Cities"));
  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);
});

test("Opening /n/ URL with author param shows READONLY", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );
  cleanup();

  renderApp({
    ...bob(),
    initialRoute: `/n/${encodeURIComponent("My Notes")}/${encodeURIComponent(
      "Cities"
    )}?author=${alice().user.publicKey}`,
  });

  await screen.findByText("READONLY");
  await expectTree(`
Cities
  Paris
  London
  `);
});

test("URL includes author param when viewing other user's content via breadcrumb", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...bob(), initialRoute: relationUrl });

  await screen.findByText("READONLY");

  await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

  await waitFor(() => {
    expect(window.location.search).toContain("author=");
  });
});

test("Clicking fullscreen while viewing other user's content preserves READONLY", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(alice());
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("show references to Cities")
  );
  await userEvent.click(
    await screen.findByLabelText("open My Notes → Cities (2) in fullscreen")
  );

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });
  const relationUrl = window.location.pathname;
  cleanup();

  renderApp({ ...bob(), initialRoute: relationUrl });

  await screen.findByText("READONLY");
  await expectTree(`
Cities
  Paris
  London
  `);

  await userEvent.click(
    await screen.findByLabelText("open Paris in fullscreen")
  );

  await screen.findByText("READONLY");
  await expectTree(`
Paris
  `);
});
