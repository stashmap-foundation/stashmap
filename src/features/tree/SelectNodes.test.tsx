import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  setup,
  forkReadonlyRoot,
  follow,
  navigateToNodeViaSearch,
  renderTree,
  expectTree,
  type,
} from "../../tests/testutils";

test("Shows no dots when user is the only one with a node", async () => {
  const [alice] = setup([ALICE]);

  renderTree(alice);
  await type("Root{Enter}Parent Node{Enter}{Tab}Child Node{Escape}");

  await expectTree(`
Root
  Parent Node
    Child Node
  `);

  // Version selector should not appear when only one version exists
  // There's no "versions available" button since Alice is the only one
  expect(screen.queryByLabelText(/versions available/)).toBeNull();
});

test("Shows dots when only other user has node (current user has none)", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(alice);
  await type("Root{Enter}Parent Node{Escape}");

  cleanup();

  await forkReadonlyRoot(bob(), alice().user.publicKey, "Root");
  await userEvent.click(
    await screen.findByLabelText("open Parent Node in fullscreen")
  );
  await userEvent.click(await screen.findByLabelText("edit Parent Node"));
  await userEvent.keyboard("{Enter}");
  await type("Bob Child{Escape}");
  cleanup();

  renderTree(alice);
  await navigateToNodeViaSearch(0, "Root");
  await expectTree(`
Root
  Parent Node
  `);

  await userEvent.click(await screen.findByLabelText("expand Parent Node"));

  await expectTree(`
Root
  Parent Node
    [S] Bob Child
  `);
});
