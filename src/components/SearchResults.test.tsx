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
} from "../utils.test";

describe("Search Results", () => {
  test("Search shows results as tree with search query as root", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    // Create some nodes to search for
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Apple pie recipe{Enter}Banana bread{Enter}Apple cider{Escape}"
    );

    await expectTree(`
My Notes
  Apple pie recipe
  Banana bread
  Apple cider
    `);

    // Click search button
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );

    // Type search query and submit
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Apple{Enter}"
    );

    // Search nodes expand by default, results shown as references with context
    await expectTree(`
Search: Apple
  My Notes (3) → Apple pie recipe
  My Notes (3) → Apple cider
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Search: Apple
  My Notes (3) → Apple pie recipe
  My Notes (3) → Apple cider
    `);
  });

  test("Search abstract reference can be expanded to show concrete refs", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates "Shared Topic" under My Notes
    renderApp(bob());
    const bobNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(bobNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Shared Topic{Escape}");

    await expectTree(`
My Notes
  Shared Topic
    `);

    cleanup();

    // Alice follows Bob - now Alice can see Bob's content
    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    // Alice should see Bob's Shared Topic as a diff item
    await expectTree(`
My Notes
  [S] Shared Topic
    `);

    // Alice creates her own "Shared Topic" under My Notes (same content-addressed node)
    const aliceNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(aliceNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Shared Topic{Escape}");

    await expectTree(`
My Notes
  Shared Topic
    `);

    // Search for "Shared Topic"
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Shared Topic{Enter}"
    );

    // Should show abstract ref (multiple refs from same context - Alice's and Bob's)
    await expectTree(`
Search: Shared Topic
  My Notes → Shared Topic
    `);

    // Expand the abstract reference
    await userEvent.click(
      await screen.findByLabelText("expand My Notes → Shared Topic")
    );

    // Should show concrete refs (one for each relation - Alice's and Bob's)
    // [O] indicates the ref is from another user (Bob)
    await expectTree(`
Search: Shared Topic
  My Notes → Shared Topic
    My Notes (1) → Shared Topic
    [O] My Notes (1) → Shared Topic
    `);
  });
});
