import { cleanup, screen } from "@testing-library/react";
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

describe("References in Referenced By", () => {
  test("Single concrete reference shows directly (no abstract wrapper)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
    );

    await expectTree(`
My Notes
  Cities
    Barcelona
      Sagrada Familia
    `);

    await userEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );

    await expectTree(`
My Notes
  Cities
    Barcelona
      My Notes → Cities → Barcelona (1)
    `);
  });

  test("Multiple concrete references from same context show under abstract", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );

    await expectTree(`
My Notes
  Cities
    Barcelona
      Alice child
    `);

    cleanup();

    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Escape}"
    );

    await expectTree(`
My Notes
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
My Notes
  Cities
    Barcelona
      My Notes → Cities → Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("expand My Notes → Cities → Barcelona")
    );

    await expectTree(`
My Notes
  Cities
    Barcelona
      My Notes → Cities → Barcelona
        [O] My Notes → Cities → Barcelona (1)
        My Notes → Cities → Barcelona (1)
    `);
  });

  test("Clicking concrete reference opens with that author's content", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );

    cleanup();

    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Escape}"
    );

    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );
    await userEvent.click(
      await screen.findByLabelText("expand My Notes → Cities → Barcelona")
    );

    await expectTree(`
My Notes
  Cities
    Barcelona
      My Notes → Cities → Barcelona
        [O] My Notes → Cities → Barcelona (1)
        My Notes → Cities → Barcelona (1)
    `);

    const fullscreenButtons = await screen.findAllByLabelText(
      "open My Notes → Cities → Barcelona (1) in fullscreen"
    );
    // Click the first one (Bob's ref is more recent, so sorted first)
    await userEvent.click(fullscreenButtons[0]);

    // Barcelona needs to be expanded to show children
    await userEvent.click(await screen.findByLabelText("expand Barcelona"));

    await expectTree(`
Barcelona
  Bob child
    `);
  });

  test("Edited node with ~Versions shows only one reference (deduplication)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes → Test A → ~Versions → Test B
    // Then the node shows as "Test B" because that's the latest version
    // Test A appears automatically under ~Versions since it's the original
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Test A{Enter}{Tab}~Versions{Enter}{Tab}Test B{Escape}"
    );

    await expectTree(`
My Notes
  Test B
    ~Versions
      Test B
      Test A
    `);

    // Show Referenced By for Test B (click the first one - the main node)
    const showRefsButtons = await screen.findAllByLabelText(
      "show references to Test B"
    );
    await userEvent.click(showRefsButtons[0]);

    // With deduplication, there's only ONE concrete reference (no abstract wrapper)
    // The same relation is reached via two paths (direct HEAD + via ~Versions),
    // but we deduplicate by relationID
    await expectTree(`
My Notes
  Test B
    My Notes → Test B (1)
    `);
  });

  test("Concrete reference paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Level1{Enter}{Tab}Level2{Enter}{Tab}Level3{Enter}{Tab}Target{Escape}"
    );

    await expectTree(`
My Notes
  Level1
    Level2
      Level3
        Target
    `);

    await userEvent.click(
      await screen.findByLabelText("show references to Target")
    );

    await expectTree(`
My Notes
  Level1
    Level2
      Level3
        Target
          My Notes → Level1 → Level2 → Level3 (1) → Target
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
