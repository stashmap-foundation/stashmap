import { screen } from "@testing-library/react";
import {
  ALICE,
  BOB,
  setup,
  renderApp,
  setupTestDB,
  findNodeByText,
} from "./utils.test";

test("App defaults to ROOT workspace when no workspace is set", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  // Should load ROOT workspace
  await screen.findByText("My Notes", undefined, { timeout: 5000 });
});

test("Navigate to specific node via URL", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    [
      "Workspace 1",
      [
        ["Node A", []],
        ["Node B", []],
      ],
    ],
  ]);

  const workspace1 = findNodeByText(db, "Workspace 1");
  expect(workspace1).toBeDefined();

  // Navigate to Workspace 1 via URL
  renderApp({ ...alice(), initialRoute: `/w/${workspace1!.id}` });

  // Should show Workspace 1
  await screen.findByText("Workspace 1", undefined, { timeout: 5000 });
  await screen.findByText("Node A");
});

test("activeWorkspace persists in localStorage per user", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  // Setup data for both users
  const aliceDB = await setupTestDB(alice(), [["Alice Workspace", []]]);
  const bobDB = await setupTestDB(bob(), [["Bob Workspace", []]]);

  const aliceWorkspace = findNodeByText(aliceDB, "Alice Workspace");
  const bobWorkspace = findNodeByText(bobDB, "Bob Workspace");

  // Alice navigates to her workspace
  const { fileStore: aliceFileStore, unmount: aliceUnmount } = renderApp({
    ...alice(),
    initialRoute: `/w/${aliceWorkspace!.id}`,
  });

  await screen.findByText("Alice Workspace");

  // Check localStorage was set for Alice
  expect(aliceFileStore.getLocalStorage(`${ALICE.publicKey}:activeWs`)).toBe(
    aliceWorkspace!.id
  );

  // Clean up Alice's render
  aliceUnmount();

  // Bob navigates to his workspace
  const { fileStore: bobFileStore } = renderApp({
    ...bob(),
    initialRoute: `/w/${bobWorkspace!.id}`,
  });

  await screen.findByText("Bob Workspace");

  // Check localStorage was set for Bob with different key
  expect(bobFileStore.getLocalStorage(`${BOB.publicKey}:activeWs`)).toBe(
    bobWorkspace!.id
  );

  // Alice's localStorage should still be set
  expect(bobFileStore.getLocalStorage(`${ALICE.publicKey}:activeWs`)).toBe(
    aliceWorkspace!.id
  );
});

test("localStorage workspace loads on app start", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Saved Workspace", [["Node X", []]]],
  ]);

  const savedWorkspace = findNodeByText(db, "Saved Workspace");

  // Set localStorage to saved workspace
  alice().fileStore.setLocalStorage(
    `${ALICE.publicKey}:activeWs`,
    savedWorkspace!.id
  );

  // Render app without initial route (should load from localStorage)
  renderApp({ ...alice(), initialRoute: "/" });

  // Should load the saved workspace from localStorage
  await screen.findByText("Saved Workspace", undefined, { timeout: 5000 });
});

test("URL workspace takes priority over localStorage", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["URL Workspace", []],
    ["LocalStorage Workspace", []],
  ]);

  const urlWorkspace = findNodeByText(db, "URL Workspace");
  const localStorageWorkspace = findNodeByText(db, "LocalStorage Workspace");

  // Set localStorage to one workspace
  alice().fileStore.setLocalStorage(
    `${ALICE.publicKey}:activeWs`,
    localStorageWorkspace!.id
  );

  // But navigate via URL to a different workspace
  renderApp({ ...alice(), initialRoute: `/w/${urlWorkspace!.id}` });

  // Should show URL workspace, not localStorage workspace
  await screen.findByText("URL Workspace", undefined, { timeout: 5000 });
  expect(screen.queryByText("LocalStorage Workspace")).toBeNull();
});

test("Refresh page restores activeWorkspace from localStorage", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Persistent Workspace", []]]);

  const workspace = findNodeByText(db, "Persistent Workspace");

  // First render - navigate to workspace
  const view = renderApp({
    ...alice(),
    initialRoute: `/w/${workspace!.id}`,
  });

  await screen.findByText("Persistent Workspace");

  // Verify localStorage was set
  expect(view.fileStore.getLocalStorage(`${ALICE.publicKey}:activeWs`)).toBe(
    workspace!.id
  );

  // Unmount (simulating page close)
  view.unmount();

  // Second render - no initial route (simulating page refresh)
  // localStorage should still have the workspace
  renderApp({ ...alice(), initialRoute: "/" });

  // Should restore from localStorage
  await screen.findByText("Persistent Workspace", undefined, { timeout: 5000 });
});
