import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  follow,
  renderTree,
  setup,
} from "../utils.test";

test("Reference node opens with only reference path, not current pane stack", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderTree(bob);
  await userEvent.type(
    await findNewNodeEditor(),
    "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
  );

  await expectTree(`
My Notes
  Holiday Destinations
    Spain
  `);

  cleanup();

  await follow(alice, bob().user.publicKey);

  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "My Notes{Escape}");

  await expectTree(`
My Notes
  [S] Holiday Destinations
  `);

  await userEvent.click(
    await screen.findByLabelText("open Holiday Destinations in fullscreen")
  );

  await expectTree(`
[O] My Notes
  [O] Holiday Destinations
  `);

  const breadcrumbs = screen.getByLabelText("Navigation breadcrumbs");
  expect(within(breadcrumbs).getByText("My Notes")).toBeDefined();
  expect(screen.queryByLabelText("Navigate to My Notes")).toBeNull();
  expect(
    screen.queryByLabelText("Navigate to Holiday Destinations")
  ).toBeNull();
  expect(screen.queryByTestId("current-stack")).toBeNull();
});
