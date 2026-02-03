import { screen } from "@testing-library/react";
import {
  ALICE,
  setup,
  renderApp,
  setupTestDB,
  findNodeByText,
} from "./utils.test";

test("App defaults to ROOT pane when visiting /", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), initialRoute: "/" });

  // Should load ROOT pane
  await screen.findByLabelText("collapse My Notes", undefined, {
    timeout: 5000,
  });
});

test("Navigate to specific node via URL", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Test Node", []]]);

  const testNode = findNodeByText(db, "Test Node");
  expect(testNode).toBeDefined();

  // Navigate directly to the node via URL
  renderApp({ ...alice(), initialRoute: `/w/${testNode!.id}` });

  // The node should now be displayed as root
  await screen.findByLabelText(/expand Test Node|collapse Test Node/);
});
