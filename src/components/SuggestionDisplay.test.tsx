import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  setup,
  follow,
  forkReadonlyRoot,
  unfollow,
  readonlyRoute,
  renderTree,
  renderApp,
  findNewNodeEditor,
  expectTree,
  type,
  navigateToNodeViaSearch,
} from "../utils.test";

describe("Suggestion Display", () => {
  test("Suggestion from other user shows without breadcrumbs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await type("Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");
    cleanup();

    renderTree(alice);
    await expectTree(`
My Notes
  [S] Holiday Destinations
    `);
  });

  test("Other user's children show as suggestions with version", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("Child1{Enter}Child2{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );

    await expectTree(`
Topic
  [S] Child1
  [S] Child2
    `);
  });

  test("Suggestion and version appear when both users have same topic", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}AliceChild{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("BobChild{Escape}");
    cleanup();

    renderTree(alice);
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

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Shared{Enter}{Tab}AliceChild{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Shared in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Shared"));
    await userEvent.keyboard("{Enter}");
    await type("BobChild{Escape}");
    cleanup();

    renderTree(alice);
    await expectTree(`
My Notes
  Shared
    AliceChild
    [S] BobChild
    `);
  });

  test("unfollowing removes cached suggestions from that user", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}AliceChild{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("BobChild{Escape}");
    cleanup();

    renderTree(alice);
    await expectTree(`
My Notes
  Topic
    AliceChild
    [S] BobChild
    `);

    await unfollow(alice, bob().user.publicKey);

    await expectTree(`
My Notes
  Topic
    AliceChild
    `);
  });

  test("Expanding a suggestion shows the other user's grandchildren", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Enter}Bolognese{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );

    await expectTree(`
Recipes
  [S] Pasta
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
Recipes
  [S] Pasta
    [O] Carbonara
    [O] Bolognese
    `);
  });

  test("only one divider line when suggestion is expanded", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
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
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Enter}{Tab}Ingredients{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );

    await expectTree(`
Recipes
  [S] Pasta
    `);

    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
Recipes
  [S] Pasta
    [O] Carbonara
    `);

    await userEvent.click(await screen.findByLabelText("expand Carbonara"));

    await expectTree(`
Recipes
  [S] Pasta
    [O] Carbonara
      [O] Ingredients
    `);
  });

  test("Copied suggestion becomes regular item without [S] marker", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );

    await expectTree(`
Recipes
  [S] Pasta
    `);

    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Pasta{Escape}");

    await expectTree(`
Recipes
  Pasta
    `);
  });

  test("Other user's ~Log cref suggestions resolve to linked note text", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Alice Root{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Alice Root");
    await userEvent.click(await screen.findByLabelText("edit Alice Root"));
    await userEvent.keyboard("{Enter}");
    await type("Bob Child{Escape}");
    cleanup();

    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Alice Root
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();

    cleanup();
    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Alice Root
    `);

    expect(screen.queryByText("Error: Node not found")).toBeNull();
  });

  test("suggestion not swallowed by children in other own relation", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type(
      "Travel{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}Austria{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
    );
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type("Austria{Escape}");
    cleanup();

    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    [S] Austria
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
    await forkReadonlyRoot(
      bob(),
      alice().user.publicKey,
      "My Notes",
      "Holiday Destinations"
    );
    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type("Austria{Enter}Berlin{Enter}Rome{Enter}Vienna{Escape}");
    await forkReadonlyRoot(
      bob(),
      alice().user.publicKey,
      "My Notes",
      "Holiday Destinations"
    );
    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
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
    await follow(bob, alice().user.publicKey);
    await follow(carol, alice().user.publicKey);

    renderTree(alice);
    await type("Topic{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Topic");
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type(
      "BobChild1{Enter}BobChild2{Enter}BobChild3{Enter}BobChild4{Escape}"
    );
    cleanup();

    await forkReadonlyRoot(carol(), alice().user.publicKey, "Topic");
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("CarolChild{Escape}");
    cleanup();

    renderTree(alice);

    await expectTree(`
Topic
  [S] CarolChild
  [S] BobChild1
  [S] BobChild2
  [VO] +4
    `);

    cleanup();
    renderApp({
      ...alice(),
      initialRoute: readonlyRoute(bob().user.publicKey, "Topic"),
    });
    await screen.findByText("READONLY");

    await expectTree(`
[O] Topic
  [O] BobChild1
  [O] BobChild2
  [O] BobChild3
  [O] BobChild4
  [VO] +1 -4
  [VO] -4
    `);
  });

  test("declining copied list suggestion hides it and reveals the next one", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Holiday Destinations{Escape}");
    cleanup();

    await forkReadonlyRoot(
      bob(),
      alice().user.publicKey,
      "Holiday Destinations"
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type(
      "Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );
    cleanup();

    renderTree(alice);

    await expectTree(`
Holiday Destinations
  [S] Spain
  [S] France
  [S] Italy
  [VO] +5
    `);

    await userEvent.click(await screen.findByLabelText("decline Spain"));

    await expectTree(`
Holiday Destinations
  [S] France
  [S] Italy
  [S] Portugal
  [VO] +5
    `);
  });

  test("no version shown when all suggestions fit within cap", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Recipes{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Recipes");
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}Risotto{Enter}Curry{Escape}");
    cleanup();

    renderTree(alice);

    await expectTree(`
Recipes
  [S] Pasta
  [S] Risotto
  [S] Curry
    `);
  });

  test("accepting copied list suggestions reveals later suggestions", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type("Holiday Destinations{Escape}");
    cleanup();

    await forkReadonlyRoot(
      bob(),
      alice().user.publicKey,
      "Holiday Destinations"
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type(
      "Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );
    cleanup();

    renderTree(alice);

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

  test("multiple users suggestions are pooled newest first", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);
    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    await follow(bob, alice().user.publicKey);
    await follow(carol, alice().user.publicKey);

    renderTree(alice);
    await type("Cooking{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Cooking");
    await userEvent.click(await screen.findByLabelText("edit Cooking"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}Risotto{Escape}");
    cleanup();

    await forkReadonlyRoot(carol(), alice().user.publicKey, "Cooking");
    await userEvent.click(await screen.findByLabelText("edit Cooking"));
    await userEvent.keyboard("{Enter}");
    await type("Sushi{Enter}Tacos{Enter}Curry{Escape}");
    cleanup();

    renderTree(alice);

    await expectTree(`
Cooking
  [S] Sushi
  [S] Tacos
  [S] Curry
  [VO] +2
    `);
  });

  test("fork of other user's list becomes an own editable note", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);
    await follow(bob, alice().user.publicKey);

    renderTree(alice);
    await type(
      "Recipes{Enter}{Tab}Pasta{Enter}Salad{Enter}Soup{Enter}Stew{Escape}"
    );
    await forkReadonlyRoot(bob(), alice().user.publicKey, "Recipes");
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
    await follow(bob, alice().user.publicKey);

    renderApp(alice());
    await type("Target{Enter}{Tab}Items{Escape}");
    cleanup();

    // Bob creates Source (with child), forks Target, then alt-drags Source into his copy.
    renderApp(bob());
    await type("Source{Enter}{Tab}Child{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), alice().user.publicKey, "Target");

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

    // Alice sees Bob's extra cref-derived items as suggestions on her base version.
    renderTree(alice);

    await expectTree(`
Target
  Items
  [S] Source
    `);

    await userEvent.click(await screen.findByLabelText("decline Source"));

    await expectTree(`
Target
  Items
  [VO] +1
    `);
  });
});
