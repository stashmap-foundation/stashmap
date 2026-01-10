import { screen } from "@testing-library/react";
import {
  ALICE,
  setup,
  renderApp,
  setupTestDB,
  findNodeByText,
} from "./utils.test";

test("App defaults to ROOT workspace when visiting /", async () => {
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
