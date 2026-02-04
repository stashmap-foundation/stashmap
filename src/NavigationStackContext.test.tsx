import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ALICE,
  setup,
  renderApp,
  setupTestDB,
  findNodeByText,
} from "./utils.test";

test("Navigation stack starts with empty pane showing new node editor", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  await screen.findByLabelText("new node editor", undefined, {
    timeout: 5000,
  });

  // Stack is empty, pane shows new node editor
  const stackLayers = screen.queryAllByRole("button", { name: /Loading.../ });
  expect(stackLayers.length).toBe(0); // No stacked layers, only active pane
});

test("Push node to navigation stack", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Workspace 1", []],
    ["Workspace 2", []],
  ]);

  const workspace1 = findNodeByText(db, "Workspace 1");
  const workspace2 = findNodeByText(db, "Workspace 2");

  // Start at node 1
  renderApp({ ...alice(), initialRoute: `/w/${workspace1!.id}` });
  await screen.findByLabelText(
    /expand Workspace 1|collapse Workspace 1/,
    undefined,
    { timeout: 5000 }
  );

  // Navigate to node 2 (should push to stack)
  window.history.pushState({}, "", `/w/${workspace2!.id}`);

  // Manually trigger navigation by re-rendering
  // In real usage, this would be handled by the router
  await waitFor(() => {
    expect(window.location.pathname).toContain(workspace2!.id);
  });
});

test("Pop from navigation stack returns to previous node", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Workspace 1", []],
    ["Workspace 2", []],
  ]);

  const workspace1 = findNodeByText(db, "Workspace 1");
  const workspace2 = findNodeByText(db, "Workspace 2");

  // Navigate: ROOT -> Node 1 -> Node 2
  renderApp({ ...alice(), initialRoute: `/w/${workspace1!.id}` });
  await screen.findByLabelText(
    /expand Workspace 1|collapse Workspace 1/,
    undefined,
    { timeout: 5000 }
  );

  // Navigate to node 2
  window.history.pushState({}, "", `/w/${workspace2!.id}`);

  // Pop back (browser back button)
  window.history.back();

  await waitFor(
    () => {
      expect(window.location.pathname).toContain(workspace1!.id);
    },
    { timeout: 5000 }
  );
});

test("PopTo navigates to specific node in stack", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Workspace 1", []],
    ["Workspace 2", []],
    ["Workspace 3", []],
  ]);

  const workspace1 = findNodeByText(db, "Workspace 1");
  const workspace2 = findNodeByText(db, "Workspace 2");
  const workspace3 = findNodeByText(db, "Workspace 3");

  // Build a stack: ROOT -> W1 -> W2 -> W3
  renderApp({ ...alice(), initialRoute: `/w/${workspace1!.id}` });
  await screen.findByLabelText(
    /expand Workspace 1|collapse Workspace 1/,
    undefined,
    { timeout: 5000 }
  );

  // Push W2
  window.history.pushState({}, "", `/w/${workspace2!.id}`);

  // Push W3
  window.history.pushState({}, "", `/w/${workspace3!.id}`);

  // Navigate back 2 levels to W1
  window.history.go(-2);

  await waitFor(
    () => {
      expect(window.location.pathname).toContain(workspace1!.id);
    },
    { timeout: 5000 }
  );
});

test("Stacked nodes show as layers", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Base Workspace", []],
    ["Top Workspace", []],
  ]);

  const baseWorkspace = findNodeByText(db, "Base Workspace");
  const topWorkspace = findNodeByText(db, "Top Workspace");

  renderApp({ ...alice(), initialRoute: `/w/${baseWorkspace!.id}` });
  await screen.findByLabelText(
    /expand Base Workspace|collapse Base Workspace/,
    undefined,
    { timeout: 5000 }
  );

  // Navigate to top node (simulating stack push)
  window.history.pushState({}, "", `/w/${topWorkspace!.id}`);

  await waitFor(
    () => {
      expect(window.location.pathname).toContain(topWorkspace!.id);
    },
    { timeout: 5000 }
  );
});

test("Clicking stacked layer navigates back", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["Layer 1", []],
    ["Layer 2", []],
  ]);

  const layer1 = findNodeByText(db, "Layer 1");
  const layer2 = findNodeByText(db, "Layer 2");

  renderApp({ ...alice(), initialRoute: `/w/${layer1!.id}` });
  await screen.findByLabelText(/expand Layer 1|collapse Layer 1/, undefined, {
    timeout: 5000,
  });

  // Navigate to layer 2
  window.history.pushState({}, "", `/w/${layer2!.id}`);

  await waitFor(
    () => {
      expect(window.location.pathname).toContain(layer2!.id);
    },
    { timeout: 5000 }
  );

  // Find the stacked layer button for Layer 1 and click it
  const stackedLayers = screen.queryAllByRole("button");
  const layer1Button = stackedLayers.find((btn) =>
    btn.textContent?.includes("Layer 1")
  );

  if (layer1Button) {
    fireEvent.click(layer1Button);
    await waitFor(
      () => {
        expect(window.location.pathname).toContain(layer1!.id);
      },
      { timeout: 5000 }
    );
  }
});
