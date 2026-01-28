import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  renderApp,
  setup,
  getTreeStructure,
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
    await userEvent.click(await screen.findByLabelText("Search"));

    // Type search query and submit
    await userEvent.type(
      await screen.findByLabelText("Search query"),
      "Apple{Enter}"
    );

    // Wait for search to complete and debug output
    await waitFor(async () => {
      const tree = await getTreeStructure();
      console.log("Current tree:", tree);
    });

    // Should show search results with search query as root
    // Expand to see results
    await userEvent.click(await screen.findByLabelText("expand Search: Apple"));

    // Debug after expand
    await waitFor(async () => {
      const tree = await getTreeStructure();
      console.log("After expand:", tree);
    });

    await expectTree(`
Search: Apple
  Apple pie recipe
  Apple cider
    `);

    cleanup();
    renderApp(alice());

    await waitFor(async () => {
      const tree = await getTreeStructure();
      console.log("After cleanup/rerender:", tree);
    });

    await expectTree(`
Search: Apple
  Apple pie recipe
  Apple cider
    `);
  });
});
