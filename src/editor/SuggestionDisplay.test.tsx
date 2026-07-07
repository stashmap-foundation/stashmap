import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  setup,
  forkOwnRoot,
  forkReadonlyRoot,
  readonlyRoute,
  renderTree,
  renderApp,
  findNewNodeEditor,
  expectTree,
  type,
  navigateToNodeViaSearch,
  requireUser,
} from "../utils.test";

describe("Suggestion Display", () => {
  test("Suggestion from own fork shows without breadcrumbs", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(await screen.findByLabelText("edit My Fork"));
    await userEvent.keyboard("{Enter}");
    await type("Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
    await expectTree(`
My Notes
  [S] Holiday Destinations
  [S] My Notes My Fork
    `);
  });

  test("Fork's children show as suggestions with version", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("Child1{Enter}Child2{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );

    await expectTree(`
Topic
  [S] Child1
  [S] Child2
    `);
  });

  test("Suggestion and version appear when fork shares a topic", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}AliceChild{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("BobChild{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
    await expectTree(`
My Notes
  Topic
    AliceChild
    [S] BobChild
  [S] My Notes My Fork
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

  test("Suggestion and version appear when fork and original share a topic", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Shared{Enter}{Tab}AliceChild{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Shared in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Shared"));
    await userEvent.keyboard("{Enter}");
    await type("BobChild{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
    await expectTree(`
My Notes
  Shared
    AliceChild
    [S] BobChild
  [S] My Notes My Fork
    `);
  });

  test("Expanding a suggestion shows the fork's grandchildren", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Enter}Bolognese{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
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
    [S] Carbonara
    [S] Bolognese
    `);
  });

  test("only one divider line when suggestion is expanded", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("expand Pasta"));

    await expectTree(`
Recipes
  [S] Pasta
    [S] Carbonara
    `);

    // eslint-disable-next-line testing-library/no-node-access
    const dividers = document.querySelectorAll(".first-virtual");
    expect(dividers).toHaveLength(1);
  });

  test("Deep suggestion tree is fully expandable", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}{Tab}Carbonara{Enter}{Tab}Ingredients{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
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
    [S] Carbonara
    `);

    await userEvent.click(await screen.findByLabelText("expand Carbonara"));

    await expectTree(`
Recipes
  [S] Pasta
    [S] Carbonara
      [S] Ingredients
    `);
  });

  test("Typing identical text does not suppress a suggestion", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Recipes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Recipes in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Recipes"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");
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
  [S] Pasta
    `);
  });

  test("Other user's ~Log cref suggestions resolve to linked note text", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("Alice Root{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "Alice Root");
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

  test("suggestion not swallowed by children in other own node", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type(
      "Travel{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}Austria{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
    );
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type("Austria{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    [S] Austria
  [S] My Notes My Fork
    `);
  });

  test("shows suggestions from all forks of the same list", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter}Italy{Enter}Portugal{Escape}"
    );
    cleanup();

    await forkOwnRoot(alice, "My Notes", "Fork One");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Fork One");
    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await type("Austria{Enter}Berlin{Enter}Rome{Enter}Vienna{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "Fork Two");
    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Fork Two");
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
    await navigateToNodeViaSearch(0, "My Notes");
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
    [V] +4
  [S] My Notes Fork Two
  [S] My Notes Fork One
    `);
  });

  test("no suggestions shown when viewing other user's READONLY content", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("Topic{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Topic", "Fork One");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Fork One");
    await userEvent.click(await screen.findByLabelText("edit Fork One"));
    await userEvent.keyboard("{Enter}");
    await type("Child1{Enter}Child2{Enter}Child3{Enter}Child4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Topic");

    await expectTree(`
Topic
  [S] Child1
  [S] Child2
  [S] Child3
  [V] +4
  [S] Topic Fork One
    `);

    cleanup();
    window.history.pushState({}, "", "/");
    renderApp({
      ...bob(),
      initialRoute: readonlyRoute(requireUser(alice()).publicKey, "Topic"),
    });
    await screen.findByText("READONLY");

    // Alice's fork lives in a document Bob was never handed a key for, so
    // its versions cannot reach him — encrypted storage closes the leak
    // that used to surface [VO] +4 here.
    await expectTree(`
[O] Topic
    `);
  });

  test("declining copied list suggestion hides it and reveals the next one", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("Holiday Destinations{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Holiday Destinations", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(await screen.findByLabelText("edit My Fork"));
    await userEvent.keyboard("{Enter}");
    await type(
      "Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Holiday Destinations");

    await expectTree(`
Holiday Destinations
  [S] Spain
  [S] France
  [S] Italy
  [V] +5
  [S] Holiday Destinations My Fork
    `);

    await userEvent.click(await screen.findByLabelText("decline Spain"));

    await expectTree(`
Holiday Destinations
  [S] France
  [S] Italy
  [S] Portugal
  [V] +4
  [S] Holiday Destinations My Fork
    `);
  });

  test("no version shown when all suggestions fit within cap", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("Recipes{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Recipes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(await screen.findByLabelText("edit My Fork"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}Risotto{Enter}Curry{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Recipes");

    await expectTree(`
Recipes
  [S] Pasta
  [S] Risotto
  [S] Curry
  [S] Recipes My Fork
    `);
  });

  test("accepting copied list suggestions reveals later suggestions", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("Holiday Destinations{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Holiday Destinations", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(await screen.findByLabelText("edit My Fork"));
    await userEvent.keyboard("{Enter}");
    await type(
      "Spain{Enter}France{Enter}Italy{Enter}Portugal{Enter}Greece{Escape}"
    );
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Holiday Destinations");

    await expectTree(`
Holiday Destinations
  [S] Spain
  [S] France
  [S] Italy
  [V] +5
  [S] Holiday Destinations My Fork
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
  [V] +4
  [S] Holiday Destinations My Fork
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
  [S] Holiday Destinations My Fork
    `);
  });

  test("suggestions from multiple forks are pooled newest first", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("Cooking{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Cooking", "Fork One");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Fork One");
    await userEvent.click(await screen.findByLabelText("edit Fork One"));
    await userEvent.keyboard("{Enter}");
    await type("Pasta{Enter}Risotto{Escape}");
    cleanup();

    await forkOwnRoot(alice, "Cooking", "Fork Two");
    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Fork Two");
    await userEvent.click(await screen.findByLabelText("edit Fork Two"));
    await userEvent.keyboard("{Enter}");
    await type("Sushi{Enter}Tacos{Enter}Curry{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Cooking");

    await expectTree(`
Cooking
  [S] Sushi
  [S] Tacos
  [S] Curry
  [V] +2
  [S] Cooking Fork Two
  [S] Cooking Fork One
    `);
  });

  test("fork of other user's list becomes an own editable note", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type(
      "Recipes{Enter}{Tab}Pasta{Enter}Salad{Enter}Soup{Enter}Stew{Escape}"
    );
    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "Recipes");
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
    const [alice] = setup([ALICE]);

    renderApp(alice());
    await type("Target{Enter}{Tab}Items{Escape}");

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Source{Enter}{Tab}Child{Escape}");
    cleanup();

    // Fork Target, then alt-drag Source into the fork.
    await forkOwnRoot(alice, "Target", "My Fork");
    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Fork");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "My Fork" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  [R] Source
  Items
    `);
    cleanup();

    // The original sees the fork's extra cref-derived item as a suggestion.
    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Target");

    await expectTree(`
Target
  Items
  [S] Source
  [S] Target My Fork
    `);

    await userEvent.click(await screen.findByLabelText("decline Source"));

    await expectTree(`
Target
  Items
  [S] Target My Fork
    `);
  });
});
