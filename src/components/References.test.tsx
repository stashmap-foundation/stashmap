import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  renderTree,
  setup,
  type,
} from "../utils.test";

describe("Incoming references and occurrences", () => {
  test("Occurrence shows when same node is head of a root-level relation", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Barcelona{Enter}{Tab}Best Tapas{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Sagrada Familia
      [C] Barcelona
    `);
  });

  test("Other user's version shows as suggestion and version entry", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Escape}"
    );
    cleanup();

    renderTree(alice);
    await expectTree(`
Notes
  Cities
    Barcelona
      Alice child
      [S] Bob child
    `);
  });

  test("Clicking version fullscreen opens with that author's content", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Enter}Bob2{Enter}Bob3{Enter}Bob4{Escape}"
    );
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 -1 in fullscreen/)
    );

    await expectTree(`
[O] Barcelona
  [O] Bob child
  [O] Bob2
  [O] Bob3
  [O] Bob4
  [VO] +1 -4
    `);
  });

  test("Edited node with ~Versions shows only one incoming reference (deduplication)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}Test A{Enter}{Tab}~Versions{Enter}{Tab}Test B{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Other{Enter}{Tab}Test B{Enter}{Tab}Child{Escape}");

    await expectTree(`
Other
  Test B
    Child
    [I] Test B  <<< Notes
    `);

    await userEvent.click(
      await screen.findByLabelText(/open .* <<< Notes in fullscreen/)
    );

    await expectTree(`
Notes
  Test B
    `);
  });

  test("Concrete reference paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}Level1{Enter}{Tab}Level2{Enter}{Tab}Level3{Enter}{Tab}Target{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Other{Enter}{Tab}Target{Enter}{Tab}Child{Escape}");

    await expectTree(`
Other
  Target
    Child
    [I] Target  <<< Level3 / Level2 / Level1 / Notes
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
