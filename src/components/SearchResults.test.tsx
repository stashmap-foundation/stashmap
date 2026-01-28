import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
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
});
