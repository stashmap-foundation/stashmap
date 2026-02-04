import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
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
  Notes (3) → Apple pie recipe
  Notes (3) → Apple cider
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Search: Apple
  Notes (3) → Apple pie recipe
  Notes (3) → Apple cider
    `);
  });

  test("Search abstract reference can be expanded to show concrete refs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderApp(bob());
    await type("Notes{Enter}Shared Topic{Escape}");

    await expectTree(`
Notes
  Shared Topic
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await type("Notes{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Notes"));

    await expectTree(`
Notes
  [S] Shared Topic
    `);

    await userEvent.click(await screen.findByLabelText("edit Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Shared Topic{Escape}");

    await expectTree(`
Notes
  Shared Topic
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Shared Topic{Enter}"
    );

    await expectTree(`
Search: Shared Topic
  Notes → Shared Topic
    `);

    await userEvent.click(
      await screen.findByLabelText("expand Notes → Shared Topic")
    );

    await expectTree(`
Search: Shared Topic
  Notes → Shared Topic
    Notes (1) → Shared Topic
    [O] Notes (1) → Shared Topic
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
  Notes → Holiday Destinations → Spain (1) → Barcelona
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
  [O] Notes → Holiday Destinations → Spain (1) → Barcelona
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
