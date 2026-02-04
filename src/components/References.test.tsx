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

describe("References in Referenced By", () => {
  test("Single concrete reference shows directly (no abstract wrapper)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Sagrada Familia
    `);

    await userEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Notes → Cities → Barcelona (1)
    `);
  });

  test("Multiple concrete references from same context show under abstract", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Alice child
    `);

    cleanup();

    renderTree(bob);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Escape}"
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Bob child
    `);

    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Notes → Cities → Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("expand Notes → Cities → Barcelona")
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Notes → Cities → Barcelona
        [O] Notes → Cities → Barcelona (1)
        Notes → Cities → Barcelona (1)
    `);
  });

  test("Clicking concrete reference opens with that author's content", async () => {
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
    await userEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );
    await userEvent.click(
      await screen.findByLabelText("expand Notes → Cities → Barcelona")
    );

    await expectTree(`
Notes
  Cities
    Barcelona
      Notes → Cities → Barcelona
        [O] Notes → Cities → Barcelona (1)
        Notes → Cities → Barcelona (1)
    `);

    const fullscreenButtons = await screen.findAllByLabelText(
      "open Notes → Cities → Barcelona (1) in fullscreen"
    );
    await userEvent.click(fullscreenButtons[0]);

    await expectTree(`
Barcelona
  Bob child
    `);
  });

  test("Edited node with ~Versions shows only one reference (deduplication)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}Test A{Enter}{Tab}~Versions{Enter}{Tab}Test B{Escape}"
    );

    await expectTree(`
Notes
  Test B
    ~Versions
      Test B
      Test A
    `);

    const showRefsButtons = await screen.findAllByLabelText(
      "show references to Test B"
    );
    await userEvent.click(showRefsButtons[0]);

    await expectTree(`
Notes
  Test B
    Notes → Test B (1)
    `);
  });

  test("Concrete reference paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}Level1{Enter}{Tab}Level2{Enter}{Tab}Level3{Enter}{Tab}Target{Escape}"
    );

    await expectTree(`
Notes
  Level1
    Level2
      Level3
        Target
    `);

    await userEvent.click(
      await screen.findByLabelText("show references to Target")
    );

    await expectTree(`
Notes
  Level1
    Level2
      Level3
        Target
          Notes → Level1 → Level2 → Level3 (1) → Target
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
