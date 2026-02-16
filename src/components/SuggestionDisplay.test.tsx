import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  setup,
  follow,
  renderTree,
  renderApp,
  findNewNodeEditor,
  expectTree,
  type,
} from "../utils.test";

const maybeExpand = async (label: string): Promise<void> => {
  const btn = screen.queryByLabelText(label);
  if (btn) {
    await userEvent.click(btn);
  }
};

describe("Suggestion Display", () => {
  test("Suggestion from other user shows without breadcrumbs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    France
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Escape}");
    await expectTree(`
My Notes
  [S] Holiday Destinations
  [VO] +1
    `);
  });

  test("Other user's children show as suggestions with version", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Topic{Enter}{Tab}Child1{Enter}Child2{Escape}"
    );

    await expectTree(`
My Notes
  Topic
    Child1
    Child2
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Escape}");
    await maybeExpand("expand Topic");

    await expectTree(`
My Notes
  Topic
    [S] Child1
    [S] Child2
    [VO] +2
    `);
  });

  test("Suggestion and version appear when both users have same topic", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  Topic
    BobChild
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}AliceChild{Escape}");

    await expectTree(`
My Notes
  Topic
    AliceChild
    [S] BobChild
    [VO] +1 -1
    `);
  });

  test("Search results show breadcrumbs", async () => {
    const [alice] = setup([ALICE]);

    renderApp(alice());
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
      Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [R] My Notes / Holiday Destinations / Spain >>> Barcelona
    `);
  });

  test("Suggestion and version appear when both users share a topic", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Shared{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  Shared
    BobChild
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Shared{Enter}{Tab}AliceChild{Escape}");

    await expectTree(`
My Notes
  Shared
    AliceChild
    [S] BobChild
    [VO] +1 -1
    `);
  });

  test("Expanding a suggestion shows the other user's grandchildren", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Recipes{Enter}{Tab}Pasta{Enter}{Tab}Carbonara{Enter}Bolognese{Escape}"
    );

    await expectTree(`
My Notes
  Recipes
    Pasta
      Carbonara
      Bolognese
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");

    await maybeExpand("expand Recipes");

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
    [VO] +1
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
      [O] Bolognese
    [VO] +1
    `);
  });

  test("Deep suggestion tree is fully expandable", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Recipes{Enter}{Tab}Pasta{Enter}{Tab}Carbonara{Enter}{Tab}Ingredients{Escape}"
    );

    await expectTree(`
My Notes
  Recipes
    Pasta
      Carbonara
        Ingredients
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");

    await maybeExpand("expand Recipes");

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
    [VO] +1
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
    [VO] +1
    `);

    await userEvent.click(await screen.findByLabelText("expand Carbonara"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
        [O] Ingredients
    [VO] +1
    `);
  });

  test("Copied suggestion becomes regular item without [S] marker", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Recipes{Enter}{Tab}Pasta{Escape}");

    await expectTree(`
My Notes
  Recipes
    Pasta
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");

    await expectTree(`
My Notes
  Recipes
    `);

    await maybeExpand("expand Recipes");

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
    [VO] +1
    `);

    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Pasta{Escape}");

    await expectTree(`
My Notes
  Recipes
    Pasta
    `);
  });

  test("Other user's ~Log cref suggestions resolve to linked note text", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("Bob Root{Enter}{Tab}Bob Child{Escape}");
    cleanup();

    renderTree(alice);
    await type("Alice Root{Escape}");
    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Alice Root
  [S] Bob Root
  [VO] +1 -1
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();

    cleanup();
    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Alice Root
  [S] Bob Root
  [VO] +1 -1
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();
  });
});
