import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// eslint-disable-next-line import/no-unresolved
import { BasicRelayInformation } from "nostr-tools/lib/types/nip11";
import { renderApp, setup, ALICE, expectTree, type } from "../utils.test";

describe("Search", () => {
  test("NIP-50 relay search returns results that might not match client-side filter", async () => {
    const [alice] = setup([ALICE]);
    renderApp({
      ...alice(),
      nip11: {
        searchDebounce: 0,
        fetchRelayInformation: () => {
          return Promise.resolve({
            supported_nips: [50],
          } as BasicRelayInformation);
        },
      },
    });

    await type("Notes{Enter}Bitcoin{Escape}");

    await expectTree(`
Notes
  Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    const searchInput = await screen.findByLabelText("search input");
    await userEvent.type(searchInput, "Bitcoin{Enter}");

    await screen.findByText(/Notes.*→ Bitcoin/);
    await screen.findByLabelText("collapse Search: Bitcoin");
  });

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
  Notes (2) → Bitcoin
    `);

    await waitFor(() => {
      expect(screen.queryByText("Bircoin")).toBeNull();
    });
  });
});
