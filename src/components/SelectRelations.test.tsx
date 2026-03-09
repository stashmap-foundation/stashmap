import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  setup,
  follow,
  renderTree,
  expectTree,
  type,
} from "../utils.test";

test("Shows no dots when user is the only one with a relation", async () => {
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

test("Shows dots when only other user has relation (current user has none)", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type("Root{Enter}Parent Node{Enter}{Tab}Bob Child{Escape}");

  await expectTree(`
Root
  Parent Node
    Bob Child
  `);

  cleanup();

  renderTree(alice);
  await type("Root{Enter}Parent Node{Escape}");

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
