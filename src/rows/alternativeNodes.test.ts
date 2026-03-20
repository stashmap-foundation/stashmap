import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  setup,
  follow,
  forkReadonlyRoot,
  renderTree,
  findNewNodeEditor,
  expectTree,
  type,
} from "../tests/testutils";

describe("Version display via basedOn chain", () => {
  test("version from other user appears when they add children", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Topics{Enter}{Tab}Apples{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Topics");
    await userEvent.click(await screen.findByLabelText("edit Topics"));
    await userEvent.keyboard("{Enter}");
    await type("Oranges{Enter}Bananas{Enter}Grapes{Enter}Pears{Escape}");
    cleanup();

    renderTree(alice);
    await expectTree(`
Topics
  Apples
  [S] Oranges
  [S] Bananas
  [S] Grapes
  [VO] +4
    `);
  });

  test("version with zero diff is not shown in tree", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Topics{Enter}{Tab}Apples{Enter}Oranges{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Topics");
    await userEvent.click(await screen.findByLabelText("edit Topics"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");
    cleanup();

    renderTree(alice);
    await expectTree(`
Topics
  Apples
  Oranges
    `);
  });

  test("versions from multiple users appear", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);
    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    await follow(bob, alice().user.publicKey);
    await follow(carol, alice().user.publicKey);

    renderTree(alice);
    await type("Music{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Music");
    await userEvent.click(await screen.findByLabelText("edit Music"));
    await userEvent.keyboard("{Enter}");
    await type("Jazz{Enter}Blues{Enter}Rock{Enter}Pop{Escape}");
    cleanup();

    await forkReadonlyRoot(carol(), alice().user.publicKey, "Music");
    await userEvent.click(await screen.findByLabelText("edit Music"));
    await userEvent.keyboard("{Enter}");
    await type(
      "Classical{Enter}Opera{Enter}Ambient{Enter}Folk{Enter}Country{Escape}"
    );
    cleanup();

    renderTree(alice);
    await expectTree(`
Music
  [S] Classical
  [S] Opera
  [S] Ambient
  [VO] +5
  [VO] +4
    `);
  });
});
