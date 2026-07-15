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

  test("Dangling entity link opens a transient surface with its label", async () => {
    const [alice] = setup([ALICE]);
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    renderApp({ ...alice(), fetchEntityMetadata });

    await type(
      "Places{Enter}{Tab}https://www.wikidata.org/wiki/Q131723{Escape}"
    );

    await expectTree(`
Places
  https://www.wikidata.org/wiki/Q131723
    `);
    expect(screen.queryByText(/deleted/)).toBeNull();

    const entityLink = screen.getByRole("link", {
      name: "https://www.wikidata.org/wiki/Q131723",
    });
    expect(entityLink.style.color).toBe("var(--violet)");
    await userEvent.click(entityLink);

    await expectTree(`
https://www.wikidata.org/wiki/Q131723
  [I] Places ↩
    `);
    expect(
      new URLSearchParams(window.location.search).get("fallbackLabel")
    ).toBe("https://www.wikidata.org/wiki/Q131723");
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));
  });

  test("Id-only dangling entity route stays read-only with a default title", async () => {
    const [alice] = setup([ALICE]);
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    const { relayPool } = renderApp({
      ...alice(),
      fetchEntityMetadata,
      initialRoute: "/r/wd%3AQ999?source=local",
    });

    await screen.findByRole("treeitem", { name: "Entity wd:Q999" });
    expect(relayPool.getDecryptedEvents()).toHaveLength(0);
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));
  });

  test("Existing local entity home opens without label request", async () => {
    const [alice] = setup([ALICE]);
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    renderApp({ ...alice(), fetchEntityMetadata });

    await type("https://www.wikidata.org/wiki/Q1492{Escape}");
    await expectTree(`
https://www.wikidata.org/wiki/Q1492
    `);

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Trip{Escape}");
    Reflect.defineProperty(navigator, "clipboard", {
      value: {
        readText: jest.fn(() => Promise.resolve("[Barcelona](#wd:Q1492)")),
      },
      configurable: true,
    });
    await userEvent.click(screen.getByRole("treeitem", { name: "Trip" }));
    await userEvent.keyboard("{Meta>}v{/Meta}");

    await userEvent.click(screen.getByRole("link", { name: "Barcelona" }));
    await expectTree(`
https://www.wikidata.org/wiki/Q1492
  [I] Trip ↩
    `);
    expect(fetchEntityMetadata).not.toHaveBeenCalled();
  });

  test("Differently labelled entity links keep their own route titles", async () => {
    const [alice] = setup([ALICE]);
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    renderApp({ ...alice(), fetchEntityMetadata });

    await type("Trip{Escape}");
    Reflect.defineProperty(navigator, "clipboard", {
      value: {
        readText: jest.fn(() =>
          Promise.resolve("[Barcelona](#wd:Q1492)\n[Barna](#wd:Q1492)")
        ),
      },
      configurable: true,
    });
    await userEvent.click(screen.getByRole("treeitem", { name: "Trip" }));
    await userEvent.keyboard("{Meta>}v{/Meta}");

    await expectTree(`
Trip
  Barcelona
  Barna
    `);

    await userEvent.click(screen.getByRole("link", { name: "Barcelona" }));
    await expectTree(`
Barcelona
  [I] Trip ↩
    `);
    expect(
      new URLSearchParams(window.location.search).get("fallbackLabel")
    ).toBe("Barcelona");
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByLabelText("Go back"));
    await userEvent.click(screen.getByRole("link", { name: "Barna" }));
    await expectTree(`
Barna
  [I] Trip ↩
    `);
    expect(
      new URLSearchParams(window.location.search).get("fallbackLabel")
    ).toBe("Barna");
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));
  });

  test("Wikidata 429 starts a provider cooldown for other entities", async () => {
    const [alice] = setup([ALICE]);
    const rateLimitedResponse = new Response("", { status: 429 });
    Reflect.defineProperty(rateLimitedResponse, "status", { value: 429 });
    Reflect.defineProperty(rateLimitedResponse, "headers", {
      value: { get: () => "60" },
    });
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(rateLimitedResponse)
    );
    renderApp({ ...alice(), fetchEntityMetadata });

    await type("Trip{Escape}");
    Reflect.defineProperty(navigator, "clipboard", {
      value: {
        readText: jest.fn(() =>
          Promise.resolve("[Barcelona](#wd:Q1492)\n[Madrid](#wd:Q2807)")
        ),
      },
      configurable: true,
    });
    await userEvent.click(screen.getByRole("treeitem", { name: "Trip" }));
    await userEvent.keyboard("{Meta>}v{/Meta}");

    await userEvent.click(screen.getByRole("link", { name: "Barcelona" }));
    await expectTree(`
Barcelona
  [I] Trip ↩
    `);
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    await userEvent.click(await screen.findByLabelText("Go back"));
    await userEvent.click(screen.getByRole("link", { name: "Madrid" }));
    await expectTree(`
Madrid
  [I] Trip ↩
    `);
    expect(fetchEntityMetadata).toHaveBeenCalledTimes(1);
  });

  test("Resolved Wikidata labels replace only the transient title and route hint", async () => {
    const [alice] = setup([ALICE]);
    const fetchEntityMetadata = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            entities: {
              Q1492: {
                labels: {
                  de: { value: "Barcelona auf Deutsch" },
                  en: { value: "Barcelona" },
                },
              },
            },
          }),
          { status: 200 }
        )
      )
    );
    const originalLanguages = navigator.languages;
    Reflect.defineProperty(navigator, "languages", {
      value: ["de-DE", "en-US"],
      configurable: true,
    });
    renderApp({
      ...alice(),
      fetchEntityMetadata,
      initialRoute: "/r/wd%3AQ1492?source=local&fallbackLabel=Local%20Name",
    });

    screen.getByRole("treeitem", { name: "Local Name" });
    await waitFor(() => expect(fetchEntityMetadata).toHaveBeenCalledTimes(1));
    await screen.findByRole("treeitem", { name: "Barcelona auf Deutsch" });
    expect(
      new URLSearchParams(window.location.search).get("fallbackLabel")
    ).toBe("Barcelona auf Deutsch");
    expect(fetchEntityMetadata).toHaveBeenCalledTimes(1);
    Reflect.defineProperty(navigator, "languages", {
      value: originalLanguages,
      configurable: true,
    });
  });

  test("First write on a dangling entity surface creates one canonical root", async () => {
    const [alice] = setup([ALICE]);
    const asset = "asset:rgb:AAAABBBBCCCCDDDDEEEE12345";
    const { relayPool } = renderApp({
      ...alice(),
      initialRoute: `/r/${encodeURIComponent(
        asset
      )}?source=local&fallbackLabel=Asset%20Label`,
    });

    await screen.findByRole("treeitem", { name: "Asset Label" });
    expect(relayPool.getDecryptedEvents()).toHaveLength(0);

    await userEvent.click(await screen.findByLabelText("edit Asset Label"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await screen.findByLabelText("new node editor"),
      "Child"
    );
    await userEvent.keyboard("{Escape}");

    await expectTree(`
Asset Label
  Child
    `);
    await waitFor(() => {
      expect(
        relayPool
          .getDecryptedEvents()
          .some(
            (event) =>
              event.content.includes(`Asset Label <!-- id:${asset} -->`) &&
              event.content.includes("Child")
          )
      ).toBe(true);
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
            "[Remote target](#33333333-3333-4333-8333-333333333333)\n[Remote website](https://example.com/page#section)"
          )
        ),
      },
      configurable: true,
    });
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByRole("link", {
      name: "Remote target. Target no longer exists",
    });
    await screen.findByRole("link", {
      name: "Remote website (opens externally)",
    });

    const shared = await copySecretLinkViaChip(bob(), "Remote Notes");
    cleanup();
    renderApp({ ...alice(), initialRoute: shared });

    expect(
      await screen.findByRole("link", { name: "Navigate to Remote target" })
    ).toBeDefined();
    const website = await screen.findByRole("link", {
      name: "Remote website (opens externally)",
    });
    expect(website.getAttribute("href")).toBe(
      "https://example.com/page#section"
    );
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("↗")).toBeDefined();
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
