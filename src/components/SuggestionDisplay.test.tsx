import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  setup,
  follow,
  renderTree,
  renderApp,
  findNewNodeEditor,
  expectTree,
  type,
  navigateToNodeViaSearch,
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
  [R] My Notes / Holiday Destinations / Spain / Barcelona
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
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
      [O] Bolognese
    `);
  });

  test("only one divider line when suggestion is expanded", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Recipes{Enter}{Tab}Pasta{Enter}{Tab}Carbonara{Escape}"
    );
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    await maybeExpand("expand Recipes");
    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
    `);

    // eslint-disable-next-line testing-library/no-node-access
    const dividers = document.querySelectorAll(".first-virtual");
    expect(dividers).toHaveLength(1);
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
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
    `);

    await userEvent.click(await screen.findByLabelText("expand Carbonara"));

    await expectTree(`
My Notes
  Recipes
    [S] Pasta
      [O] Carbonara
        [O] Ingredients
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
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();

    cleanup();
    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Alice Root
  [S] Bob Root
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();
  });

  test("suggestion not swallowed by items in other own relation", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}Austria{Escape}"
    );
    cleanup();

    renderTree(alice);
    await type(
      "Travel{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}Austria{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    [S] Austria
    [C] Travel / Holiday Destinations
    `);
  });

  test("shows suggestions from all forks of the same list", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter}Italy{Enter}Portugal{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Holiday Destinations{Escape}");
    await maybeExpand("expand Holiday Destinations");

    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 in fullscreen/)
    );
    await screen.findByText("READONLY");
    await userEvent.click(
      await screen.findByLabelText("fork to make your own copy")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type("Austria{Enter}Berlin{Enter}Rome{Enter}Vienna{Escape}");

    await userEvent.click(
      await screen.findByLabelText(/open .* -4 in fullscreen/)
    );
    await screen.findByText("READONLY");
    await userEvent.click(
      await screen.findByLabelText("fork to make your own copy")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Munich{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    France
    Italy
    Portugal
    [S] Munich
    [S] Austria
    [S] Berlin
    [VO] +4
    `);
  });

  test("no suggestions shown when viewing other user's READONLY content", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);
    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);

    renderTree(bob);
    await type(
      "Topic{Enter}{Tab}BobChild1{Enter}BobChild2{Enter}BobChild3{Enter}BobChild4{Escape}"
    );
    cleanup();

    renderTree(carol);
    await type("Topic{Enter}{Tab}CarolChild{Escape}");
    cleanup();

    renderTree(alice);
    await type("Topic{Escape}");

    await expectTree(`
Topic
  [S] CarolChild
  [S] BobChild1
  [S] BobChild2
  [VO] +4
    `);

    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 in fullscreen/)
    );
    await screen.findByText("READONLY");

    await expectTree(`
[O] Topic
  [O] BobChild1
  [O] BobChild2
  [O] BobChild3
  [O] BobChild4
  [VO] +1 -4
    `);
  });

  test("declining version entry hides all suggestions from that list", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );

    await expectTree(`
Holiday Destinations
  Spain
  France
  Italy
  Portugal
  Greece
    `);
    cleanup();

    renderTree(alice);
    await type("Holiday Destinations{Escape}");

    await expectTree(`
Holiday Destinations
  [S] Spain
  [S] France
  [S] Italy
  [VO] +5
    `);

    await userEvent.click(await screen.findByLabelText(/decline.*\+5/));

    await expectTree(`
Holiday Destinations
    `);
  });

  test("no version shown when all suggestions fit within cap", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("Recipes{Enter}{Tab}Pasta{Enter}Risotto{Enter}Curry{Escape}");
    cleanup();

    renderTree(alice);
    await type("Recipes{Escape}");

    await expectTree(`
Recipes
  [S] Pasta
  [S] Risotto
  [S] Curry
    `);
  });

  test("suggestions capped, version shows full diff, accepting surfaces next until version disappears", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );
    cleanup();

    renderTree(alice);
    await type("Holiday Destinations{Escape}");

    await expectTree(`
Holiday Destinations
  [S] Spain
  [S] France
  [S] Italy
  [VO] +5
    `);

    await userEvent.click(
      await screen.findByLabelText("accept Spain as relevant")
    );

    await expectTree(`
Holiday Destinations
  Spain
  [S] France
  [S] Italy
  [S] Portugal
  [VO] +4
    `);

    await userEvent.click(
      await screen.findByLabelText("accept France as relevant")
    );

    await expectTree(`
Holiday Destinations
  Spain
  France
  [S] Italy
  [S] Portugal
  [S] Greece
    `);
  });

  test("multiple users suggestions pooled newest first, version per user when exceeding cap", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);
    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);

    renderTree(bob);
    await type("Cooking{Enter}{Tab}Pasta{Enter}Risotto{Escape}");
    cleanup();

    renderTree(carol);
    await type("Cooking{Enter}{Tab}Sushi{Enter}Tacos{Enter}Curry{Escape}");
    cleanup();

    renderTree(alice);
    await type("Cooking{Escape}");

    await expectTree(`
Cooking
  [S] Sushi
  [S] Tacos
  [S] Curry
  [VO] +2
    `);
  });

  test("fork of other user's list shows as own version entry", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type(
      "Recipes{Enter}{Tab}Pasta{Enter}Salad{Enter}Soup{Enter}Stew{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type("Recipes{Escape}");

    await expectTree(`
Recipes
  [S] Pasta
  [S] Salad
  [S] Soup
  [VO] +4
    `);

    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 in fullscreen/)
    );
    await screen.findByText("READONLY");
    await userEvent.click(
      await screen.findByLabelText("fork to make your own copy")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Curry{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(bob);
    await expectTree(`
Recipes
  Curry
  Pasta
  Salad
  Soup
  Stew
    `);
  });
});

describe("Cref suggestions", () => {
  test("declining cref suggestion hides it permanently", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    // Bob creates Source (with child) and Target, then alt-drags Source into Target
    renderApp(bob());
    await type("Source{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Target{Enter}{Tab}Items{Escape}");

    await expectTree(`
Target
  Items
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);
    await navigateToNodeViaSearch(0, "Target");

    await expectTree(`
Target
  [R] Source
  Items
    `);
    cleanup();

    // Alice creates Target and sees Bob's items as suggestions
    renderTree(alice);
    await type("Target{Escape}");

    await expectTree(`
Target
  [S] Source
  [S] Items
    `);

    await userEvent.click(await screen.findByLabelText("decline Source"));

    await expectTree(`
Target
  [S] Items
  [VO] +2
    `);
  });
});
