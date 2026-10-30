import fs from "fs";
import os from "os";
import path from "path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BOB, expectTree, renderApp, setup } from "../utils.test";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "../testFixtures/workspace";
import { LOCAL } from "../core/nodeRef";
import { KIND_KNOWLEDGE_DEPOSIT } from "../nostr";
import { depositLinkTags } from "../nodesDocumentEvent";
import { loadWorkspaceAsDocuments } from "../infra/filesystem/workspaceBackend";
import {
  buildCoordinateRouteUrl,
  buildDocumentRouteUrl,
} from "../navigationUrl";
import { mockRelayPool, MockRelayPool } from "../nostrMock.test";
import { createWorkspaceProfile } from "../cli/init";
import { loadCliProfile } from "../cli/config";

const RELAY_URL = "wss://relay.test/";

function profilePubkey(workspacePath: string): PublicKey {
  const { pubkey } = loadCliProfile({ cwd: workspacePath });
  if (!pubkey) {
    throw new Error(`Missing workspace pubkey for ${workspacePath}`);
  }
  return pubkey;
}

function fixedWorkspace(author: KeyPair): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-test-"));
  createWorkspaceProfile({
    workspaceDir: workspacePath,
    workspaceConfig: { storageRelays: [], roomRelays: [RELAY_URL] },
    secretKey: author.privateKey,
  });
  return workspacePath;
}

async function workspaceWithDocument(
  relativePath: string,
  content: string
): Promise<string> {
  const workspacePath = knowstrInit({ relays: [RELAY_URL] }).path;
  write(workspacePath, relativePath, content);
  await knowstrSave(workspacePath);
  return workspacePath;
}

async function fixedWorkspaceWithDocument(
  author: KeyPair,
  relativePath: string,
  content: string
): Promise<string> {
  const workspacePath = fixedWorkspace(author);
  write(workspacePath, relativePath, content);
  await knowstrSave(workspacePath);
  return workspacePath;
}

function fergusonDocument(
  rootId: string,
  title: string,
  quotePrefix: string,
  quoteCount: number
): string {
  const quoteLines = Array.from({ length: quoteCount }, (_, index) => {
    const n = index + 1;
    return [
      `- Quote ${n} <!-- id:${quotePrefix}-quote-${n} -->`,
      `  - [Austria](wikidata:Q40) <!-- id:${quotePrefix}-austria-link-${n} -->`,
    ];
  }).flat();
  return [`# ${title} <!-- id:${rootId} -->`, ...quoteLines, ""].join("\n");
}

async function groupingWorkspace(quoteCount: number): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(
    workspacePath,
    "ferguson.md",
    fergusonDocument("ferguson-book", "Ferguson", "ferguson", quoteCount)
  );
  await knowstrSave(workspacePath);
  return workspacePath;
}

async function multiSourceGroupingWorkspace(): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(
    workspacePath,
    "ferguson-a.md",
    fergusonDocument("ferguson-a", "Ferguson A", "ferguson-a", 2)
  );
  write(
    workspacePath,
    "ferguson-b.md",
    fergusonDocument("ferguson-b", "Ferguson B", "ferguson-b", 2)
  );
  await knowstrSave(workspacePath);
  return workspacePath;
}

function depositEvents(
  relayPool: MockRelayPool,
  dTag: string
): ReturnType<MockRelayPool["getEvents"]> {
  return relayPool
    .getEvents()
    .filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DEPOSIT &&
        event.tags.some(([name, value]) => name === "d" && value === dTag)
    );
}

async function publishDepositFixture(
  relayPool: MockRelayPool,
  workspacePath: string,
  dTag: string,
  contentNeedle: string
): Promise<void> {
  const profile = loadCliProfile({ cwd: workspacePath });
  const documents = await loadWorkspaceAsDocuments(profile);
  const document = documents.find((candidate) => candidate.docId === dTag);
  if (!document) {
    throw new Error(`Missing fixture document ${dTag}`);
  }
  const content = fs.readFileSync(path.join(workspacePath, dTag), "utf8");
  const ms = Date.now();
  expect(content).toContain(contentNeedle);
  await Promise.all(
    relayPool.publish([RELAY_URL], {
      id: `${dTag}-${ms}`.padEnd(64, "0").slice(0, 64),
      pubkey: profilePubkey(workspacePath),
      created_at: Math.floor(ms / 1000),
      kind: KIND_KNOWLEDGE_DEPOSIT,
      tags: [
        ["d", dTag],
        ...depositLinkTags(
          document.docId,
          profilePubkey(workspacePath),
          content
        ),
        ["ms", `${ms}`],
      ],
      content,
      sig: "0".repeat(128),
    })
  );
}

async function removeDepositFixture(
  relayPool: MockRelayPool,
  dTag: string
): Promise<void> {
  const previous = depositEvents(relayPool, dTag).at(-1);
  if (!previous) {
    throw new Error(`Missing fixture deposit ${dTag}`);
  }
  const ms = Date.now();
  await Promise.all(
    relayPool.publish([RELAY_URL], {
      ...previous,
      id: `${dTag}-removed-${ms}`.padEnd(64, "0").slice(0, 64),
      created_at: Math.floor(ms / 1000),
      tags: [
        ...previous.tags.filter(([name]) => name === "a" || name === "i"),
        ["d", dTag],
        ["ms", `${ms}`],
      ],
      content: "",
    })
  );
}

async function withNow(ms: number, action: () => Promise<void>): Promise<void> {
  const spy = jest.spyOn(Date, "now").mockReturnValue(ms);
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
}

test("two strangers find each other through an entity", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "barcelona.md",
    [
      "# Alice Barcelona <!-- id:alice-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:alice-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
  });

  await publishDepositFixture(
    relayPool,
    alicePath,
    "barcelona.md",
    "Alice Barcelona"
  );

  await expectTree(`
Barcelona
  [OI] Alice Barcelona ↩
  `);

  const incomingLink = await screen.findByRole("link", {
    name: /Navigate to Alice Barcelona/u,
  });
  await userEvent.click(incomingLink);

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/deposit\//u);
    expect(new URLSearchParams(window.location.search).get("at")).toBe(
      "alice-root"
    );
  });
  await screen.findByText("READONLY");
  await expectTree(`
[O] Alice Barcelona
  [O] Barcelona
  `);
  expect(
    relayPool.getEvents().filter((event) => event.pubkey === BOB.publicKey)
  ).toHaveLength(0);
});

test("a feed present only in a pulled document projects its entries", async () => {
  const relayPool = mockRelayPool();
  const url = "https://scholarium.at/salon.ics";
  const alicePath = await workspaceWithDocument(
    "salon.md",
    [
      "# Alice Salon <!-- id:alice-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:alice-link -->",
      `- ![${url}](${url.replace(
        "https://",
        "webcal://"
      )}) <!-- id:alice-feed -->`,
      "",
    ].join("\n")
  );
  const fetchCalendarFeed = jest.fn(() =>
    Promise.resolve(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:sommerfest@scholarium.at",
        "DTSTART;VALUE=DATE:20300714",
        "SUMMARY:Sommerfest",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n")
    )
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
    fetchCalendarFeed,
  });

  await publishDepositFixture(relayPool, alicePath, "salon.md", "Alice Salon");

  const incomingLink = await screen.findByRole("link", {
    name: /Navigate to Alice Salon/u,
  });
  await userEvent.click(incomingLink);
  await screen.findByText("READONLY");
  await waitFor(() => expect(fetchCalendarFeed).toHaveBeenCalledWith(url));

  await userEvent.click(await screen.findByLabelText(`expand ${url}`));
  await screen.findByText("14.07.2030 Sommerfest");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(url);
});

test("accepting remote incoming on an unmaterialized entity keeps bidirectional arrow", async () => {
  const relayPool = mockRelayPool();
  const bobPath = fixedWorkspace(BOB);
  const alicePath = await workspaceWithDocument(
    "barcelona.md",
    [
      "# Alice Barcelona <!-- id:alice-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:alice-link -->",
      "",
    ].join("\n")
  );
  await publishDepositFixture(
    relayPool,
    alicePath,
    "barcelona.md",
    "Alice Barcelona"
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
  });

  await expectTree(`
Barcelona
  [OI] Alice Barcelona ↩
  `);

  await userEvent.click(
    await screen.findByLabelText("accept Alice Barcelona ↩ as relevant")
  );

  await expectTree(
    `
Barcelona
  {!} Alice Barcelona↩
  `,
    { showGutter: true }
  );
});

test("entity page merges local and pulled incoming wikidata mentions", async () => {
  const relayPool = mockRelayPool();
  const bobPath = await fixedWorkspaceWithDocument(
    BOB,
    "bob-notes.md",
    [
      "# Bob Notes <!-- id:bob-notes -->",
      "- [Ludwig von Mises](wikidata:Q7242) <!-- id:bob-mises-link -->",
      "",
    ].join("\n")
  );
  const alicePath = await workspaceWithDocument(
    "alice-notes.md",
    [
      "# Alice Notes <!-- id:alice-notes-root -->",
      "- [Ludwig von Mises](wikidata:Q7242) <!-- id:alice-mises-link -->",
      "",
    ].join("\n")
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: buildDocumentRouteUrl(LOCAL, "bob-notes.md"),
  });

  await publishDepositFixture(
    relayPool,
    alicePath,
    "alice-notes.md",
    "Alice Notes"
  );
  await userEvent.click(
    await screen.findByRole("link", { name: "Ludwig von Mises" })
  );

  await expectTree(`
Ludwig von Mises
  [I] Bob Notes ↩
  [OI] Alice Notes ↩
  `);
});

test("same-path same-id local and pulled incoming entity refs stay apart without key clashes", async () => {
  const relayPool = mockRelayPool();
  const renderErrors = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const bobPath = await fixedWorkspaceWithDocument(
      BOB,
      "bitcoin.md",
      [
        "# Bitcoin <!-- id:bitcoin -->",
        "- [Ludwig von Mises](wikidata:Q7242) <!-- id:bob-mises-link -->",
        "",
      ].join("\n")
    );
    const alicePath = await workspaceWithDocument(
      "bitcoin.md",
      [
        "# Bitcoin <!-- id:bitcoin -->",
        "- [Ludwig von Mises](wikidata:Q7242) <!-- id:bob-mises-link -->",
        "",
      ].join("\n")
    );
    await renderAppTree({
      path: bobPath,
      relayPool,
      initialRoute: "/local/n/wikidata%3AQ7242?label=Ludwig%20von%20Mises",
    });

    await publishDepositFixture(relayPool, alicePath, "bitcoin.md", "Bitcoin");

    await expectTree(`
Ludwig von Mises
  [I] Bitcoin ↩
  [OI] Bitcoin ↩
  `);
    expect(
      renderErrors.mock.calls.some((call) =>
        call.some(
          (part) =>
            typeof part === "string" &&
            part.includes("Encountered two children with the same key")
        )
      )
    ).toBe(false);
  } finally {
    renderErrors.mockRestore();
  }
});

test("remote entity incoming refs open the remote deposit", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "alice-bitcoin.md",
    [
      "# Bitcoin <!-- id:bitcoin -->",
      "- [Ludwig von Mises](wikidata:Q7242) <!-- id:alice-mises-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ7242?label=Ludwig%20von%20Mises",
  });

  await publishDepositFixture(
    relayPool,
    alicePath,
    "alice-bitcoin.md",
    "Bitcoin"
  );
  await expectTree(`
Ludwig von Mises
  [OI] Bitcoin ↩
  `);

  await userEvent.click(
    await screen.findByRole("link", { name: /Navigate to Bitcoin/u })
  );
  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/deposit\//u);
    expect(new URLSearchParams(window.location.search).get("at")).toBe(
      "bitcoin"
    );
  });
  await screen.findByText("READONLY");
});

test("incoming refs stay individual below the document grouping threshold", async () => {
  const workspacePath = await groupingWorkspace(2);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await expectTree(`
Austria
  [I] Ferguson / Quote 1 ↩
  [I] Ferguson / Quote 2 ↩
  `);
  expect(screen.queryByRole("treeitem", { name: "Ferguson ↩" })).toBeNull();
});

test("incoming refs group by source root at threshold and expand with short labels", async () => {
  const workspacePath = await groupingWorkspace(3);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await expectTree(`
Austria
  [I] Ferguson ↩
  `);
  expect(screen.queryByText(/mentions/u)).toBeNull();

  await userEvent.click(await screen.findByLabelText("expand Ferguson ↩"));

  await expectTree(`
Austria
  [I] Ferguson ↩
    [I] Quote 1 ↩
    [I] Quote 2 ↩
    [I] Quote 3 ↩
  `);
  expect(screen.queryByText("Ferguson / Quote 1 ↩")).toBeNull();
});

test("accepting grouped incoming source writes one root link and suppresses its quote refs", async () => {
  const workspacePath = await groupingWorkspace(3);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await userEvent.click(
    await screen.findByLabelText("accept Ferguson ↩ as relevant")
  );

  await expectTree(
    `
Austria
  {!} Ferguson
  `,
    { showGutter: true }
  );
  await expectMarkdown(
    workspacePath,
    "austria.md",
    [
      "- [Austria](wikidata:Q40) <!-- id:... -->",
      "  - (!) ![Ferguson](ferguson.md#ferguson-book) <!-- id:... -->",
    ].join("\n")
  );
});

test("accepting one grouped child writes that ref and dissolves the remaining pair", async () => {
  const workspacePath = await groupingWorkspace(3);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await userEvent.click(await screen.findByLabelText("expand Ferguson ↩"));
  await userEvent.click(
    await screen.findByLabelText("accept Quote 1 ↩ as relevant")
  );

  await expectTree(
    `
Austria
  {!} Quote 1↩
  [I] Ferguson / Quote 2 ↩
  [I] Ferguson / Quote 3 ↩
  `,
    { showGutter: true }
  );
  await expectMarkdown(
    workspacePath,
    "austria.md",
    [
      "- [Austria](wikidata:Q40) <!-- id:... -->",
      "  - (!) ![Quote 1](ferguson.md#ferguson-quote-1) <!-- id:... -->",
    ].join("\n")
  );
});

test("incoming grouping does not merge different source documents", async () => {
  const workspacePath = await multiSourceGroupingWorkspace();
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await expectTree(`
Austria
  [I] Ferguson A / Quote 1 ↩
  [I] Ferguson A / Quote 2 ↩
  [I] Ferguson B / Quote 1 ↩
  [I] Ferguson B / Quote 2 ↩
  `);
});

test("remote incoming groups open the source root and expanded child source rows", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "ferguson.md",
    fergusonDocument("ferguson-book", "Ferguson", "alice-ferguson", 3)
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });

  await publishDepositFixture(relayPool, alicePath, "ferguson.md", "Ferguson");
  await expectTree(`
Austria
  [OI] Ferguson ↩
  `);
  await userEvent.click(await screen.findByLabelText("expand Ferguson ↩"));
  await expectTree(`
Austria
  [OI] Ferguson ↩
    [OI] Quote 1 ↩
    [OI] Quote 2 ↩
    [OI] Quote 3 ↩
  `);

  await userEvent.click(
    await screen.findByRole("link", { name: /Navigate to Ferguson/u })
  );
  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/deposit\//u);
    expect(new URLSearchParams(window.location.search).get("at")).toBe(
      "ferguson-book"
    );
  });

  cleanup();
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ40?label=Austria",
  });
  await expectTree(`
Austria
  [OI] Ferguson ↩
    [OI] Quote 1 ↩
    [OI] Quote 2 ↩
    [OI] Quote 3 ↩
  `);
  await userEvent.click(
    await screen.findByRole("link", { name: /Navigate to Quote 1/u })
  );
  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/deposit\//u);
    expect(new URLSearchParams(window.location.search).get("at")).toBe(
      "alice-ferguson-quote-1"
    );
  });
});

test("nonmatching and self-authored deposits do not render", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "madrid.md",
    [
      "# Alice Madrid <!-- id:alice-madrid-root -->",
      "- [Madrid](wikidata:Q2807) <!-- id:alice-madrid-link -->",
      "",
    ].join("\n")
  );
  const bobPath = await fixedWorkspaceWithDocument(
    BOB,
    "barcelona.md",
    [
      "# Bob Barcelona <!-- id:bob-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:bob-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
  });

  await publishDepositFixture(
    relayPool,
    alicePath,
    "madrid.md",
    "Alice Madrid"
  );
  await publishDepositFixture(
    relayPool,
    bobPath,
    "barcelona.md",
    "Bob Barcelona"
  );

  await expectTree(`
Barcelona
  `);
});

test("live replacement removes visible remote rows and stale events stay ignored", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "live.md",
    [
      "# Alice Barcelona <!-- id:alice-live-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:alice-live-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
  });

  await withNow(10_000, () =>
    publishDepositFixture(relayPool, alicePath, "live.md", "Alice Barcelona")
  );
  await expectTree(`
Barcelona
  [OI] Alice Barcelona ↩
  `);

  await withNow(20_000, () => removeDepositFixture(relayPool, "live.md"));
  await expectTree(`
Barcelona
  `);

  await withNow(5_000, () =>
    publishDepositFixture(relayPool, alicePath, "live.md", "Alice Barcelona")
  );
  await expectTree(`
Barcelona
  `);
});

test("tag subscriptions close when local attention navigates away", async () => {
  const relayPool = mockRelayPool();
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: [RELAY_URL],
    initialRoute: "/local/n/wikidata%3AQ1492?label=Barcelona",
  });
  await waitFor(() => {
    const subscription = relayPool
      .getSubscriptions()
      .find((sub) =>
        sub.filters.some((filter) =>
          filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT)
        )
      );
    expect(subscription?.relays).toEqual([RELAY_URL]);
  });

  await userEvent.click(await screen.findByLabelText("Create new note"));
  await waitFor(() => {
    expect(
      relayPool
        .getSubscriptions()
        .some((sub) =>
          sub.filters.some((filter) =>
            filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT)
          )
        )
    ).toBe(false);
  });
});

test("deposit routes render Loading until the exact source arrives", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "route.md",
    [
      "# Alice Barcelona <!-- id:route-root -->",
      "- [Barcelona](wikidata:Q1492) <!-- id:route-link -->",
      "",
    ].join("\n")
  );
  const route = buildCoordinateRouteUrl(
    "deposit",
    {
      eventKind: KIND_KNOWLEDGE_DEPOSIT,
      pubkey: profilePubkey(alicePath),
      dTag: "route.md",
      relays: [RELAY_URL],
    },
    undefined,
    undefined
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: ["wss://ambient-room.example/"],
    initialRoute: route,
  });

  await waitFor(() => {
    const subscription = relayPool
      .getSubscriptions()
      .find((candidate) =>
        candidate.filters.some(
          (filter) =>
            filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT) &&
            filter["#d"]?.includes("route.md")
        )
      );
    expect(subscription?.relays).toEqual([RELAY_URL]);
  });
  await screen.findByText("Loading...");
  await publishDepositFixture(
    relayPool,
    alicePath,
    "route.md",
    "Alice Barcelona"
  );
  await expectTree(`
[O] Alice Barcelona
  [O] Barcelona
  `);
});

test("a demoted link in a pulled document drills down on the exact route", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "dup.md",
    [
      "# Alice Doc <!-- id:dup-root -->",
      "- Shared <!-- id:shared -->",
      "  - Insight <!-- id:shared-i -->",
      "- ![Again](#shared) <!-- id:dup-second -->",
      "",
    ].join("\n")
  );
  const coordinate: RouteCoordinate = {
    eventKind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey: profilePubkey(alicePath),
    dTag: "dup.md",
    relays: [RELAY_URL],
  };
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    roomRelays: ["wss://ambient-room.example/"],
    initialRoute: buildCoordinateRouteUrl(
      "deposit",
      coordinate,
      undefined,
      undefined
    ),
  });
  await publishDepositFixture(relayPool, alicePath, "dup.md", "Alice Doc");
  const [depositRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(depositRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await expectTree(`
[O] Alice Doc
  [O] Shared
    [O] Insight
    [OI] Alice Doc ↩
  [O] Again
  `);

  await userEvent.click(
    await screen.findByRole("link", { name: /Navigate to Again/u })
  );
  await waitFor(() => {
    expect(window.location.pathname + window.location.search).toBe(
      buildCoordinateRouteUrl("deposit", coordinate, "dup-second", undefined)
    );
  });
  const [drilledRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(drilledRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await expectTree(`
[O] Shared
  [O] Insight
  `);
});

afterEach(() => {
  cleanup();
});
