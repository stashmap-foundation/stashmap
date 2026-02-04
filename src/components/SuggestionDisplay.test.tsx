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

describe("Suggestion Display", () => {
  test("Suggestion from other user shows without breadcrumbs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    France
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Escape}");
    await userEvent.click(await screen.findByLabelText("expand My Notes"));
    await expectTree(`
My Notes
  [S] Holiday Destinations
    `);
  });

  test("Concrete ref in Referenced By view shows breadcrumbs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}Child1{Enter}Child2{Escape}");

    await expectTree(`
My Notes
  Topic
    Child1
    Child2
    `);
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Escape}");

    await expectTree(`
My Notes
  Topic
    `);

    await userEvent.click(
      await screen.findByLabelText("show references to Topic")
    );

    await expectTree(`
My Notes
  Topic
    [O] My Notes → Topic (2)
    `);
  });

  test("Abstract ref expands to concrete refs with breadcrumbs", async () => {
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

    await userEvent.click(
      await screen.findByLabelText("show references to Topic")
    );

    await expectTree(`
My Notes
  Topic
    My Notes → Topic
    `);

    await userEvent.click(
      await screen.findByLabelText("expand My Notes → Topic")
    );

    await expectTree(`
My Notes
  Topic
    My Notes → Topic
      My Notes → Topic (1)
      [O] My Notes → Topic (1)
    `);
  });

  test("Search results show breadcrumbs", async () => {
    const [alice] = setup([ALICE]);

    renderApp(alice());
    await type("My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Escape}");

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
  My Notes → Holiday Destinations → Spain (1) → Barcelona
    `);
  });

  test("All concrete refs inside abstract ref show breadcrumbs", async () => {
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

    await userEvent.click(
      await screen.findByLabelText("show references to Shared")
    );

    await expectTree(`
My Notes
  Shared
    My Notes → Shared
    `);

    await userEvent.click(
      await screen.findByLabelText("expand My Notes → Shared")
    );

    await expectTree(`
My Notes
  Shared
    My Notes → Shared
      My Notes → Shared (1)
      [O] My Notes → Shared (1)
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

    await userEvent.click(await screen.findByLabelText("expand Recipes"));

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
});
