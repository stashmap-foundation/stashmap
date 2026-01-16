import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  renderApp,
  findNewNodeEditor,
} from "./utils.test";

test("App defaults to ROOT workspace when visiting /", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  // Should load ROOT workspace
  await screen.findByText("My Notes", undefined, { timeout: 5000 });
});

test("Navigate to specific node via URL", async () => {
  const [alice] = setup([ALICE]);

  // First render app and create nodes via editor
  renderApp({ ...alice(), initialRoute: "/" });

  // Wait for workspace to load
  await screen.findByLabelText("collapse My Notes");

  // Create Workspace 1 with children
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Workspace 1{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Workspace 1"));
  await userEvent.click(await screen.findByLabelText("add to Workspace 1"));
  await userEvent.type(await findNewNodeEditor(), "Node A{Escape}");

  // Verify Node A is visible under Workspace 1
  await screen.findByLabelText(/expand Node A|collapse Node A/);

  // Navigate to Node A using pane search
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Node A");
  await userEvent.click(await screen.findByLabelText("select Node A"));

  // Node A should now be the root
  await screen.findByLabelText(/expand Node A|collapse Node A/);
});
