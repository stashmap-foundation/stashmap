import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  forkOwnRoot,
  navigateToNodeViaSearch,
  renderTree,
  setup,
} from "../utils.test";

test("Reference node opens with only reference path, not current pane stack", async () => {
  const [alice] = setup([ALICE]);

  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "My Notes{Escape}");
  cleanup();

  await forkOwnRoot(alice, "My Notes", "My Fork");
  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Fork");
  await userEvent.click(await screen.findByLabelText("edit My Fork"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Holiday Destinations{Enter}{Tab}Spain{Escape}"
  );
  cleanup();

  window.history.pushState({}, "", "/");
  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Notes");

  await expectTree(`
My Notes
  [S] Holiday Destinations
  [S] My Notes My Fork
  `);

  await userEvent.click(
    await screen.findByLabelText("open Holiday Destinations in fullscreen")
  );

  await expectTree(`
Holiday Destinations
  Spain
  `);

  await screen.findByLabelText("Navigate to My Fork");
  expect(
    screen.queryByLabelText("Navigate to Holiday Destinations")
  ).toBeNull();
  expect(screen.queryByTestId("current-stack")).toBeNull();
});
