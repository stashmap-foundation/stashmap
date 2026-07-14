import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  copySecretLinkViaChip,
  expectTree,
  forkOwnRoot,
  forkReadonlyRoot,
  getPane,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
  requireUser,
} from "../utils.test";

describe("References", () => {
  test("Occurrence does not show when duplicate node only exists elsewhere in the same tree", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Knowstr{Enter}{Tab}Is there a place for a Notekeeping tool in an AI world?{Enter}{Tab}Which AIs would I personally want?{Enter}{Tab}Project Specific AIs{Enter}{Tab}Knowstr{Escape}"
    );

    await expectTree(`
Knowstr
  Is there a place for a Notekeeping tool in an AI world?
    Which AIs would I personally want?
      Project Specific AIs
        Knowstr
    `);
  });

  test("Fork's version shows as suggestion and version entry", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    await forkOwnRoot(alice, "Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Cities in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("open Barcelona in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Barcelona"));
    await userEvent.keyboard("{Enter}");
    await type("Bob child{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Notes");
    await expectTree(`
Notes
  Cities
    Barcelona
      Alice child
      [S] Bob child
  [S] Notes My Fork
    `);
  });

  test("Clicking version fullscreen opens with the fork's content", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    await forkOwnRoot(alice, "Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Cities in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("open Barcelona in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Barcelona"));
    await userEvent.keyboard("{Enter}");
    await type("Bob child{Enter}Bob2{Enter}Bob3{Enter}Bob4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Notes");
    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 in fullscreen/)
    );

    await expectTree(`
Barcelona
  Bob child
  Bob2
  Bob3
  Bob4
  Alice child
    `);
  });

  test("Descendant versions appear when viewing the base version", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    await forkOwnRoot(alice, "Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Cities in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("open Barcelona in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Barcelona"));
    await userEvent.keyboard("{Enter}");
    await type("Bob child{Enter}Bob2{Enter}Bob3{Enter}Bob4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "Notes");

    await expectTree(`
Notes
  Cities
    Barcelona
      Alice child
      [S] Bob child
      [S] Bob2
      [S] Bob3
      [V] +4
  [S] Notes My Fork
    `);
  });

  test("Ancestor versions appear when viewing a fork", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "Notes");
    await userEvent.click(
      await screen.findByLabelText("open Cities in fullscreen")
    );
    await userEvent.click(
      await screen.findByLabelText("open Barcelona in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Barcelona"));
    await userEvent.keyboard("{Enter}");
    await type("Bob child{Enter}Bob2{Enter}Bob3{Enter}Bob4{Escape}");

    await expectTree(`
Barcelona
  Bob child
  Bob2
  Bob3
  Bob4
  Alice child
    `);
  });

  test("Concrete reference paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}Level1{Enter}{Tab}Level2{Enter}{Tab}Level3{Enter}{Tab}Target{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Other{Enter}{Tab}Target{Enter}{Tab}Child{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Notes");
    await userEvent.click(getPane(1).getByLabelText("expand Level1"));
    await userEvent.click(getPane(1).getByLabelText("expand Level2"));
    await userEvent.click(getPane(1).getByLabelText("expand Level3"));

    const source = getPane(1).getByRole("treeitem", { name: "Target" });
    const target = getPane(0).getByRole("treeitem", { name: "Target" });

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(source);
    fireEvent.dragOver(target, { altKey: true });
    fireEvent.drop(target, { altKey: true });
    await userEvent.keyboard("{/Alt}");
    await userEvent.click(getPane(1).getByLabelText("Close pane"));

    await expectTree(`
Other
  Target
    Target
    Child
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("Dangling entity link renders plainly, never as (deleted)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Places{Enter}{Tab}https://www.wikidata.org/wiki/Q131723{Escape}"
    );

    // The pasted marker became a link row targeting wd:Q131723 with no
    // home page — the ordinary dangling state, not a deletion.
    await expectTree(`
Places
  https://www.wikidata.org/wiki/Q131723
    `);
    expect(screen.queryByText(/deleted/)).toBeNull();

    // Violet means entity — the link target carries the canonical id, so
    // recognition feedback fires with or without a home page (the violet
    // law: node id or link target).
    const entityLink = screen.getByRole("link", {
      name: "https://www.wikidata.org/wiki/Q131723",
    });
    expect(entityLink.style.color).toBe("var(--violet)");
    await userEvent.click(entityLink);
    await waitFor(() => {
      expect(decodeURIComponent(window.location.pathname)).toBe(
        "/r/wd:Q131723"
      );
    });
  });

  test("unavailable foreign links are not marked dead", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    renderApp(bob());
    await type("Remote Notes{Escape}");
    Reflect.defineProperty(navigator, "clipboard", {
      value: {
        readText: jest.fn(() =>
          Promise.resolve(
            "[Remote target](#33333333-3333-4333-8333-333333333333)"
          )
        ),
      },
      configurable: true,
    });
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByRole("link", {
      name: "Remote target. Target no longer exists",
    });

    const shared = await copySecretLinkViaChip(bob(), "Remote Notes");
    cleanup();
    renderApp({ ...alice(), initialRoute: shared });

    expect(
      await screen.findByRole("link", { name: "Navigate to Remote target" })
    ).toBeDefined();
    expect(screen.queryByText("†")).toBeNull();
  });

  test("Deleted node shows per-link dead furniture in ~Log", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  My Notes
    `);

    await userEvent.click(await screen.findByText("My Notes"));

    await expectTree(`
My Notes
  Child
    `);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Escape}{Delete}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  My Notes†
    `);

    cleanup();
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  My Notes†
    `);
    expect(
      screen.getByRole("link", {
        name: "My Notes. Target no longer exists",
      })
    ).toBeDefined();
    expect(screen.getByText("†")).toBeDefined();
  });

  test("Deleted nested node shows per-link dead furniture in ~Log", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Investment{Enter}{Tab}Alternative{Enter}{Tab}Bitcoin{Escape}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  Investment
    `);

    await userEvent.click(await screen.findByText("Investment"));

    await expectTree(`
Investment
  Alternative
    Bitcoin
    `);

    await userEvent.click(await screen.findByLabelText("edit Investment"));
    await userEvent.keyboard("{Escape}{Delete}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  Investment†
    `);

    cleanup();
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  Investment†
    `);
    expect(
      screen.getByRole("link", {
        name: "Investment. Target no longer exists",
      })
    ).toBeDefined();
    expect(screen.getByText("†")).toBeDefined();
  });
});
