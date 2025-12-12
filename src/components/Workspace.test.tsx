import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  ALICE_PRIVATE_KEY,
  ANON,
  BOB,
  CAROL,
  findNodeByText,
  renderApp,
  setup,
  setupTestDB,
} from "../utils.test";
import { newWorkspace } from "../connections";
import { createPlan, planAddWorkspace } from "../planner";
import { execute } from "../executor";

test.skip("Create a new Workspace", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderApp(alice());
  const nStart = relayPool.getEvents().length;
  const switchWsBtn = await screen.findByLabelText("switch workspace");
  await userEvent.click(switchWsBtn);
  const newWsBtn = screen.getByText("New Workspace");
  fireEvent.click(newWsBtn);
  await userEvent.type(
    screen.getByLabelText("title of new workspace"),
    "My Brand New Workspace"
  );
  await userEvent.click(screen.getByText("Create Workspace"));
  await waitFor(() => {
    // One to create the Node, one to add it to workspaces
    expect(relayPool.getEvents()).toHaveLength(nStart + 2);
  });
  await screen.findAllByText("My Brand New Workspace");
  screen.getByLabelText("search and attach to My Brand New Workspace");
});

test.skip("Load Default Workspace if user is not logged in", async () => {
  const [anon, bob] = setup([ANON, BOB]);
  const bobsDB = await setupTestDB(bob(), [["Bobs Workspace", ["Bitcoin"]]]);
  const wsNode = findNodeByText(bobsDB, "Bobs Workspace") as KnowNode;
  const ws = newWorkspace(wsNode.id, bob().user.publicKey);
  const planWithWs = planAddWorkspace(createPlan(bob()), ws);
  await execute({ ...bob(), plan: planWithWs });
  renderApp({ ...anon(), defaultWorkspace: ws.id });
  await screen.findByText("Bobs Workspace");
  await screen.findByText("Bitcoin");
  await userEvent.click(screen.getByLabelText("switch workspace"));
  expect(screen.getAllByText("Bobs Workspace").length).toBe(2);
});

test.skip("Remember active Workspace through Route changes", async () => {
  const [anon, bob, carol] = setup([ANON, BOB, CAROL]);
  const bobsDB = await setupTestDB(bob(), [["Bobs Workspace", ["Bitcoin"]]], {
    activeWorkspace: "Bobs Workspace",
  });
  const carolDB = await setupTestDB(
    carol(),
    [["Carols Workspace", ["Bitcoin"]]],
    { activeWorkspace: "Carols Workspace" }
  );
  renderApp({
    ...anon(),
    defaultWorkspace: carolDB.activeWorkspace,
    initialRoute: `/w/${bobsDB.activeWorkspace}`,
  });
  await screen.findByText("Bobs Workspace");
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    ALICE_PRIVATE_KEY
  );
  await userEvent.click(screen.getByText("Continue"));
  await screen.findByText("Bobs Workspace");

  // User is logged in
  expect(screen.queryByText("sign in")).toBeNull();
  await userEvent.click(screen.getByLabelText("switch workspace"));
  expect(screen.getAllByText("Bobs Workspace").length).toBe(2);
});

test.skip("Delete Workspace", async () => {
  const [alice] = setup([ALICE]);
  // create two Workspaces
  const aliceDBWithFirstWS = await setupTestDB(alice(), [["First Workspace"]], {
    activeWorkspace: "First Workspace",
  });
  const aliceDB = await setupTestDB(
    { ...alice(), ...aliceDBWithFirstWS },
    [["Bitcoin Workspace"]],
    { activeWorkspace: "Bitcoin Workspace" }
  );
  cleanup();
  renderApp({ ...alice(), defaultWorkspace: aliceDB.activeWorkspace });
  await screen.findByText("Bitcoin Workspace");
  await userEvent.click(await screen.findByLabelText("delete workspace"));
  // correct Workspace title is displayed
  await screen.findByText("First Workspace");
});

test.skip("Can't delete the default workspace", async () => {
  const [anon, bob] = setup([ANON, BOB]);
  const bobsDB = await setupTestDB(bob(), [["Default Workspace"]], {
    activeWorkspace: "Default Workspace",
  });

  renderApp({ ...anon(), defaultWorkspace: bobsDB.activeWorkspace });
  await screen.findByText("Default Workspace");
  // Can't delete the default workspace if not logged in
  expect(screen.queryByLabelText("delete workspace")).toBeNull();
  cleanup();

  // Can delete my own Workspace
  renderApp({ ...bob(), defaultWorkspace: bobsDB.activeWorkspace });
  await screen.findByText("Default Workspace");
  await screen.findByLabelText("delete workspace");
});
