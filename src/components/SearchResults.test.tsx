import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  renderApp,
  setup,
  type,
} from "../utils.test";

describe("Search Results", () => {
  test("Search shows results as tree with search query as root", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}Apple pie recipe{Enter}Banana bread{Enter}Apple cider{Escape}"
    );

    await expectTree(`
Notes
  Apple pie recipe
  Banana bread
  Apple cider
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Apple{Enter}"
    );

    await expectTree(`
Search: Apple
  [R] Notes / Apple pie recipe
  [R] Notes / Apple cider
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Search: Apple
  [R] Notes / Apple pie recipe
  [R] Notes / Apple cider
    `);
  });

  test("Search results deduplicate by context across users", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderApp(bob());
    await type("Notes{Enter}Shared Topic{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await type("Notes{Enter}Shared Topic{Escape}");

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Shared Topic{Enter}"
    );

    await expectTree(`
Search: Shared Topic
  [R] Notes / Shared Topic
    `);
  });

  test("Search deduplication prefers effective author even with older timestamp", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderApp(alice());
    await type("Notes{Enter}Shared Topic{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(bob());
    await type("Notes{Enter}Shared Topic{Escape}");

    cleanup();
    renderApp(alice());

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Shared Topic{Enter}"
    );

    await expectTree(`
Search: Shared Topic
  [R] Notes / Shared Topic
    `);
  });

  test("Search result context paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
Notes
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
  [R] Notes / Holiday Destinations / Spain / Barcelona
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("Cross-user search result context paths never show Loading text", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderApp(bob());
    await type(
      "Notes{Enter}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
Notes
  Holiday Destinations
    Spain
      Barcelona
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [OR] Notes / Holiday Destinations / Spain / Barcelona
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
