import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// eslint-disable-next-line import/no-unresolved
import { BasicRelayInformation } from "nostr-tools/lib/types/nip11";
import {
  renderApp,
  setup,
  ALICE,
  expectTree,
  findNewNodeEditor,
} from "../utils.test";

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

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

    await expectTree(`
My Notes
  Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    const searchInput = await screen.findByLabelText("search input");
    await userEvent.type(searchInput, "Bitcorn{Enter}");

    await expectTree(`
Search: Bitcorn
  My Notes (1) → Bitcoin
    `);
  });

  test("Client side filtering excludes non-matching results", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Bitcoin{Enter}Bircoin{Escape}"
    );

    await expectTree(`
My Notes
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
  My Notes (2) → Bitcoin
    `);

    await waitFor(() => {
      expect(screen.queryByText("Bircoin")).toBeNull();
    });
  });
});
