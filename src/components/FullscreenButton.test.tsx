import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  forkReadonlyRoot,
  follow,
  navigateToNodeViaSearch,
  renderTree,
  setup,
} from "../utils.test";

test("Reference node opens with only reference path, not current pane stack", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "My Notes{Escape}");

  cleanup();

  await follow(alice, bob().user.publicKey);
  await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Holiday Destinations{Enter}{Tab}Spain{Escape}"
  );
  cleanup();

  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Notes");

  await expectTree(`
My Notes
  [S] Holiday Destinations
  `);

  await userEvent.click(
    await screen.findByLabelText("open Holiday Destinations in fullscreen")
  );

  await expectTree(`
[O] Holiday Destinations
  [O] Spain
  `);

  await screen.findByLabelText("Navigate to My Notes");
  expect(
    screen.queryByLabelText("Navigate to Holiday Destinations")
  ).toBeNull();
  expect(screen.queryByTestId("current-stack")).toBeNull();
});
