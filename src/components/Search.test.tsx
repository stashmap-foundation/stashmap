import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp, setup, ALICE, expectTree, type } from "../utils.test";

describe("Search", () => {
  test("Client side filtering excludes non-matching results", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Notes{Enter}Bitcoin{Enter}Bircoin{Escape}");

    await expectTree(`
Notes
  Bitcoin
  Bircoin
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    const searchInput = await screen.findByLabelText("search input");
    await userEvent.type(searchInput, "Bitcoin{Enter}");

    await expectTree(`
Search: Bitcoin
  [R] Notes / Bitcoin
    `);

    await waitFor(() => {
      expect(screen.queryByText("Bircoin")).toBeNull();
    });
  });
});
