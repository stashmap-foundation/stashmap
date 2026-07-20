import fs from "fs";
import os from "os";
import path from "path";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BOB, CAROL, expectTree, renderApp, setup } from "../utils.test";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "../testFixtures/workspace";
import { LOCAL } from "../core/nodeRef";
import { KIND_KNOWLEDGE_DEPOSIT } from "../nostr";
import {
  buildCoordinateRouteUrl,
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
} from "../navigationUrl";
import { mockRelayPool, MockRelayPool } from "../nostrMock.test";
import { createWorkspaceProfile } from "../cli/init";
import { loadCliProfile } from "../cli/config";
import { RELATED_SOURCE_QUERY_TAG_LIMIT } from "../pullSources";

const RELAY_URL = "wss://relay.test/";
const RELAYS = [{ url: RELAY_URL, read: true, write: true }];

function fixedWorkspace(author: KeyPair): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-test-"));
  createWorkspaceProfile({
    workspaceDir: workspacePath,
    secretKey: author.privateKey,
    relays: RELAYS,
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

function austriaDocument(published: boolean): string {
  return [
    "---",
    "knowstr_doc_id: austria-doc",
    ...(published ? ["knowstr_publish:"] : []),
    "---",
    "# Austria <!-- id:wd:Q40 -->",
    "",
  ].join("\n");
}

function fergusonDocument(
  docId: string,
  rootId: string,
  title: string,
  quotePrefix: string,
  quoteCount: number
): string {
  const quoteLines = Array.from({ length: quoteCount }, (_, index) => {
    const n = index + 1;
    return [
      `- Quote ${n} <!-- id:${quotePrefix}-quote-${n} -->`,
      `  - [Austria](#wd:Q40) <!-- id:${quotePrefix}-austria-link-${n} -->`,
    ];
  }).flat();
  return [
    "---",
    `knowstr_doc_id: ${docId}`,
    "---",
    `# ${title} <!-- id:${rootId} -->`,
    ...quoteLines,
    "",
  ].join("\n");
}

async function groupingWorkspace(quoteCount: number): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(workspacePath, "austria.md", austriaDocument(false));
  write(
    workspacePath,
    "ferguson.md",
    fergusonDocument(
      "ferguson-doc",
      "isbn:ferguson-book",
      "Ferguson",
      "ferguson",
      quoteCount
    )
  );
  await knowstrSave(workspacePath);
  return workspacePath;
}

async function multiSourceGroupingWorkspace(): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(workspacePath, "austria.md", austriaDocument(false));
  write(
    workspacePath,
    "ferguson-a.md",
    fergusonDocument(
      "ferguson-a-doc",
      "isbn:ferguson-a",
      "Ferguson A",
      "ferguson-a",
      2
    )
  );
  write(
    workspacePath,
    "ferguson-b.md",
    fergusonDocument(
      "ferguson-b-doc",
      "isbn:ferguson-b",
      "Ferguson B",
      "ferguson-b",
      2
    )
  );
  await knowstrSave(workspacePath);
  return workspacePath;
}

function hayekDocument(): string {
  return [
    "---",
    "knowstr_doc_id: hayek-doc",
    "---",
    "# Hayek <!-- id:wd:Q1325 -->",
    "",
    "- Life in [Salzburg](#wd:Q34713) <!-- id:hayek-salzburg -->",
    "- Period at the [LSE](#wd:Q174570) <!-- id:hayek-lse -->",
    "  - Rivalry with [Keynes](#wd:Q9317) <!-- id:hayek-keynes -->",
    "",
  ].join("\n");
}

function relatedHayekSource(): string {
  return [
    "---",
    "knowstr_doc_id: hayek-lse-keynes-doc",
    "---",
    "# Hayek LSE Keynes <!-- id:alice-hayek-lse-keynes -->",
    "",
    "- [Hayek](#wd:Q1325) <!-- id:alice-hayek-link -->",
    "- [LSE](#wd:Q174570) <!-- id:alice-lse-link -->",
    "- [Keynes](#wd:Q9317) <!-- id:alice-keynes-link -->",
    "",
  ].join("\n");
}

function relatedSourceCapHost(): string {
  return [
    "---",
    "knowstr_doc_id: host-related-cap",
    "---",
    "# Host <!-- id:host-related-root -->",
    "",
    "- Quote [Mises](#wd:Q23129) and [Hayek](#wd:Q1325) <!-- id:host-related-quote -->",
    "",
  ].join("\n");
}

function relatedSourceCapSource(index: number): string {
  const suffix = index.toString().padStart(2, "0");
  return [
    "---",
    `knowstr_doc_id: source-related-${suffix}`,
    "---",
    `# Source ${suffix} <!-- id:source-related-root-${suffix} -->`,
    "",
    `- [Mises](#wd:Q23129) <!-- id:source-related-mises-${suffix} -->`,
    `- [Hayek](#wd:Q1325) <!-- id:source-related-hayek-${suffix} -->`,
    "",
  ].join("\n");
}

async function relatedSourceCapWorkspace(count: number): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(workspacePath, "host.md", relatedSourceCapHost());
  Array.from({ length: count }, (_, index) => index + 1).forEach((index) => {
    const suffix = index.toString().padStart(2, "0");
    write(workspacePath, `source-${suffix}.md`, relatedSourceCapSource(index));
  });
  await knowstrSave(workspacePath);
  return workspacePath;
}

async function relatedSourceWorkspace(): Promise<string> {
  const workspacePath = fixedWorkspace(BOB);
  write(workspacePath, "hayek.md", hayekDocument());
  await knowstrSave(workspacePath);
  return workspacePath;
}

function manyEntityDocument(count: number): string {
  return [
    "---",
    "knowstr_doc_id: many-doc",
    "---",
    "# Many <!-- id:many-root -->",
    "",
    ...Array.from(
      { length: count },
      (_, index) =>
        `- Entity ${index + 1} [Q${index + 1}](#wd:Q${
          index + 1
        }) <!-- id:many-${index + 1} -->`
    ),
    "",
  ].join("\n");
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

function relatedSourceReferenceRows(): HTMLElement[] {
  return screen.queryAllByRole("treeitem", { name: /^Source \d\d$/u });
}

async function publishDocumentThroughApp(
  relayPool: MockRelayPool,
  workspacePath: string,
  relativePath: string,
  dTag: string,
  contentNeedle: string
): Promise<void> {
  const before = depositEvents(relayPool, dTag).length;
  const view = await renderAppTree({
    path: workspacePath,
    relayPool,
    initialRoute: buildDocumentRouteUrl(LOCAL, relativePath),
  });
  try {
    const app = within(view.container);
    await userEvent.click(await app.findByLabelText("audience options"));
    await userEvent.click(await app.findByLabelText("publish document"));
    await waitFor(() => {
      const deposits = depositEvents(relayPool, dTag);
      const newest = deposits[deposits.length - 1];
      expect(deposits.length).toBeGreaterThan(before);
      expect(newest?.content).toContain(contentNeedle);
    });
  } finally {
    view.unmount();
  }
}

async function stopPublishingThroughApp(
  relayPool: MockRelayPool,
  workspacePath: string,
  relativePath: string,
  dTag: string
): Promise<void> {
  const before = depositEvents(relayPool, dTag).length;
  const view = await renderAppTree({
    path: workspacePath,
    relayPool,
    initialRoute: buildDocumentRouteUrl(LOCAL, relativePath),
  });
  try {
    const app = within(view.container);
    await userEvent.click(await app.findByLabelText("audience options"));
    await userEvent.click(await app.findByLabelText("stop publishing"));
    await waitFor(() => {
      const deposits = depositEvents(relayPool, dTag);
      const newest = deposits[deposits.length - 1];
      expect(deposits.length).toBeGreaterThan(before);
      expect(newest?.content).toBe("");
      expect(newest?.tags.some(([name]) => name === "S")).toBe(false);
    });
  } finally {
    view.unmount();
  }
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
      "---",
      "knowstr_doc_id: alice-barcelona",
      "---",
      "# Alice Barcelona <!-- id:alice-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:alice-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
  });

  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "barcelona.md",
    "alice-barcelona",
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

test("accepting remote incoming on an unmaterialized entity keeps bidirectional arrow", async () => {
  const relayPool = mockRelayPool();
  const bobPath = fixedWorkspace(BOB);
  const alicePath = await workspaceWithDocument(
    "barcelona.md",
    [
      "---",
      "knowstr_doc_id: alice-barcelona",
      "---",
      "# Alice Barcelona <!-- id:alice-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:alice-link -->",
      "",
    ].join("\n")
  );
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "barcelona.md",
    "alice-barcelona",
    "Alice Barcelona"
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
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
      "- [Ludwig von Mises](#wd:Q7242) <!-- id:bob-mises-link -->",
      "",
    ].join("\n")
  );
  const alicePath = await workspaceWithDocument(
    "alice-notes.md",
    [
      "---",
      "knowstr_doc_id: alice-notes",
      "---",
      "# Alice Notes <!-- id:alice-notes-root -->",
      "- [Ludwig von Mises](#wd:Q7242) <!-- id:alice-mises-link -->",
      "",
    ].join("\n")
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: buildDocumentRouteUrl(LOCAL, "bob-notes.md"),
  });

  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "alice-notes.md",
    "alice-notes",
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

test("same-id local and pulled incoming entity refs deduplicate", async () => {
  const relayPool = mockRelayPool();
  const renderErrors = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const bobPath = await fixedWorkspaceWithDocument(
      BOB,
      "bitcoin.md",
      [
        "# Bitcoin <!-- id:wd:Q131723 -->",
        "- [Ludwig von Mises](#wd:Q7242) <!-- id:bob-mises-link -->",
        "",
      ].join("\n")
    );
    const alicePath = await workspaceWithDocument(
      "alice-bitcoin.md",
      [
        "---",
        "knowstr_doc_id: alice-bitcoin",
        "---",
        "# Bitcoin <!-- id:wd:Q131723 -->",
        "- [Ludwig von Mises](#wd:Q7242) <!-- id:alice-mises-link -->",
        "",
      ].join("\n")
    );
    await renderAppTree({
      path: bobPath,
      relayPool,
      initialRoute: "/local/n/wd%3AQ7242?label=Ludwig%20von%20Mises",
    });

    await publishDocumentThroughApp(
      relayPool,
      alicePath,
      "alice-bitcoin.md",
      "alice-bitcoin",
      "Bitcoin"
    );

    await expectTree(`
Ludwig von Mises
  [I] Bitcoin ↩
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
      "---",
      "knowstr_doc_id: alice-bitcoin",
      "---",
      "# Bitcoin <!-- id:wd:Q131723 -->",
      "- [Ludwig von Mises](#wd:Q7242) <!-- id:alice-mises-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ7242?label=Ludwig%20von%20Mises",
  });

  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "alice-bitcoin.md",
    "alice-bitcoin",
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
      "wd:Q131723"
    );
  });
  await screen.findByText("READONLY");
});

test("incoming refs stay individual below the document grouping threshold", async () => {
  const workspacePath = await groupingWorkspace(2);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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
      "# Austria <!-- id:... -->",
      "",
      "- (!) [Ferguson](#isbn:ferguson-book) <!-- id:... -->",
    ].join("\n")
  );
});

test("accepting one grouped child writes that ref and dissolves the remaining pair", async () => {
  const workspacePath = await groupingWorkspace(3);
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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
      "# Austria <!-- id:... -->",
      "",
      "- (!) [Quote 1](#ferguson-quote-1) <!-- id:... -->",
    ].join("\n")
  );
});

test("incoming grouping does not merge different source documents", async () => {
  const workspacePath = await multiSourceGroupingWorkspace();
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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
    fergusonDocument(
      "alice-ferguson",
      "isbn:ferguson-book",
      "Ferguson",
      "alice-ferguson",
      3
    )
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
  });

  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "ferguson.md",
    "alice-ferguson",
    "Ferguson"
  );
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
      "isbn:ferguson-book"
    );
  });

  cleanup();
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
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

test("accepted grouped root links participate in published reach", async () => {
  const relayPool = mockRelayPool();
  const bobPath = fixedWorkspace(BOB);
  write(bobPath, "austria.md", austriaDocument(false));
  write(
    bobPath,
    "ferguson.md",
    fergusonDocument(
      "ferguson-doc",
      "isbn:ferguson-book",
      "Ferguson",
      "ferguson",
      3
    )
  );
  await knowstrSave(bobPath);
  const view = await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/n/wd%3AQ40?label=Austria",
  });

  await userEvent.click(
    await screen.findByLabelText("accept Ferguson ↩ as relevant")
  );
  await expectMarkdown(
    bobPath,
    "austria.md",
    [
      "# Austria <!-- id:... -->",
      "",
      "- (!) [Ferguson](#isbn:ferguson-book) <!-- id:... -->",
    ].join("\n")
  );
  view.unmount();

  await publishDocumentThroughApp(
    relayPool,
    bobPath,
    "austria.md",
    "austria-doc",
    "Ferguson"
  );
  const deposits = depositEvents(relayPool, "austria-doc");
  const newest = deposits[deposits.length - 1];
  expect(newest?.tags).toContainEqual(["S", "isbn:ferguson-book"]);

  const [reader] = setup([CAROL], { relayPool });
  renderApp({
    ...reader(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/isbn%3Aferguson-book?label=Ferguson",
  });

  await expectTree(`
Ferguson
  [OI] Austria !↩
  `);
});

test("bare one-tag entity pages do not show related source rows", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "hayek.md",
    relatedHayekSource()
  );
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "hayek.md",
    "hayek-lse-keynes-doc",
    "Hayek LSE Keynes"
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1325?label=Hayek",
  });

  await expectTree(`
Hayek
  [OI] Hayek LSE Keynes ↩
  `);
  expect(screen.queryByText("↝")).toBeNull();
});

test("related sources land under the best visible row context", async () => {
  const relayPool = mockRelayPool();
  const bobPath = await relatedSourceWorkspace();
  const alicePath = await workspaceWithDocument(
    "hayek.md",
    relatedHayekSource()
  );
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "hayek.md",
    "hayek-lse-keynes-doc",
    "Hayek LSE Keynes"
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/n/wd%3AQ1325?label=Hayek",
  });
  await waitFor(() => {
    expect(
      relayPool
        .getSubscriptions()
        .some((sub) =>
          sub.filters.some((filter) => filter["#S"]?.includes("wd:Q9317"))
        )
    ).toBe(true);
  });

  await userEvent.click(
    await screen.findByLabelText("expand Period at the LSE")
  );
  await userEvent.click(
    await screen.findByLabelText("expand Rivalry with Keynes")
  );

  await expectTree(`
Hayek
  Life in Salzburg
  Period at the LSE
    Rivalry with Keynes
      [O↝] Hayek LSE Keynes
  [OI] Hayek LSE Keynes ↩
  `);

  await userEvent.click(
    await screen.findByLabelText("Navigate to Hayek LSE Keynes")
  );
  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/deposit\//);
  });
  expect(window.location.search).toContain("at=alice-hayek-lse-keynes");
});

test("related sources include local documents", async () => {
  const bobPath = fixedWorkspace(BOB);
  write(bobPath, "hayek.md", hayekDocument());
  write(bobPath, "hayek-lse-keynes.md", relatedHayekSource());
  await knowstrSave(bobPath);
  await renderAppTree({
    path: bobPath,
    relayPool: mockRelayPool(),
    initialRoute: "/local/n/wd%3AQ1325?label=Hayek",
  });

  await userEvent.click(
    await screen.findByLabelText("expand Period at the LSE")
  );
  await userEvent.click(
    await screen.findByLabelText("expand Rivalry with Keynes")
  );

  await expectTree(`
Hayek
  Life in Salzburg
  Period at the LSE
    Rivalry with Keynes
      [↝] Hayek LSE Keynes
    [↝] Hayek LSE Keynes
  [I] Hayek LSE Keynes ↩
  `);

  await userEvent.click(
    (
      await screen.findAllByLabelText("Navigate to Hayek LSE Keynes")
    )[0]
  );
  await waitFor(() => {
    expect(window.location.pathname).toBe("/local/n/alice-hayek-lse-keynes");
  });
});

test("many related sources are capped below document rows and uncapped fullscreen", async () => {
  const workspacePath = await relatedSourceCapWorkspace(8);
  await withNow(1_000, async () => {
    await renderAppTree({
      path: workspacePath,
      relayPool: mockRelayPool(),
      initialRoute: "/local/n/host-related-root",
    });
  });

  await userEvent.click(
    await screen.findByLabelText("expand Quote Mises and Hayek")
  );

  await waitFor(() => {
    expect(relatedSourceReferenceRows()).toHaveLength(7);
  });
  await userEvent.click(
    await screen.findByLabelText("Open to see more related sources")
  );
  await waitFor(() => {
    expect(window.location.pathname).toBe("/local/n/host-related-quote");
    expect(relatedSourceReferenceRows()).toHaveLength(8);
  });
  expect(
    screen.queryByLabelText("Open to see more related sources")
  ).toBeNull();
});

test("more related sources action opens the host row in split pane", async () => {
  const workspacePath = await relatedSourceCapWorkspace(8);
  await withNow(1_000, async () => {
    await renderAppTree({
      path: workspacePath,
      relayPool: mockRelayPool(),
      initialRoute: "/local/n/host-related-root",
    });
  });

  await userEvent.click(
    await screen.findByLabelText("expand Quote Mises and Hayek")
  );

  await screen.findByLabelText("Open to see more related sources");
  const splitButtons = await screen.findAllByLabelText("open in split pane");
  await userEvent.click(splitButtons[splitButtons.length - 1]);

  await screen.findByLabelText("Search to change pane 1 content");
  await waitFor(() => {
    expect(relatedSourceReferenceRows()).toHaveLength(15);
  });
});

test("related source interests are capped per pane", async () => {
  const relayPool = mockRelayPool();
  const bobPath = fixedWorkspace(BOB);
  write(
    bobPath,
    "many.md",
    manyEntityDocument(RELATED_SOURCE_QUERY_TAG_LIMIT + 25)
  );
  await knowstrSave(bobPath);
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/d/many-doc",
  });

  await waitFor(() => {
    expect(
      relayPool
        .getSubscriptions()
        .flatMap((sub) => sub.filters)
        .filter(
          (filter) =>
            filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT) && filter["#S"]
        )
    ).toHaveLength(2);
  });
  const tagFilters = relayPool
    .getSubscriptions()
    .flatMap((sub) => sub.filters)
    .flatMap((filter) =>
      filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT) && filter["#S"]
        ? [filter["#S"]]
        : []
    );
  expect(
    tagFilters.filter((tags) => tags.length === RELATED_SOURCE_QUERY_TAG_LIMIT)
  ).toHaveLength(1);
  expect(
    tagFilters.some((tags) => tags.length > RELATED_SOURCE_QUERY_TAG_LIMIT)
  ).toBe(true);
});

test("accepting a related source writes one root link under its context", async () => {
  const relayPool = mockRelayPool();
  const bobPath = await relatedSourceWorkspace();
  const alicePath = await workspaceWithDocument(
    "hayek.md",
    relatedHayekSource()
  );
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "hayek.md",
    "hayek-lse-keynes-doc",
    "Hayek LSE Keynes"
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: "/local/n/wd%3AQ1325?label=Hayek",
  });

  await userEvent.click(
    await screen.findByLabelText("expand Period at the LSE")
  );
  await userEvent.click(
    await screen.findByLabelText("expand Rivalry with Keynes")
  );
  await userEvent.click(
    await screen.findByLabelText("accept Hayek LSE Keynes as relevant")
  );

  await expectTree(
    `
Hayek
  Life in Salzburg
  Period at the LSE
    Rivalry with Keynes
      {!} Hayek LSE Keynes
  [OI] Hayek LSE Keynes ↩
  `,
    { showGutter: true }
  );
  await expectMarkdown(
    bobPath,
    "hayek.md",
    [
      "# Hayek <!-- id:... -->",
      "",
      "- Life in [Salzburg](#wd:Q34713) <!-- id:... -->",
      "- Period at the [LSE](#wd:Q174570) <!-- id:... -->",
      "  - Rivalry with [Keynes](#wd:Q9317) <!-- id:... -->",
      "    - (!) [Hayek LSE Keynes](#alice-hayek-lse-keynes) <!-- id:... -->",
    ].join("\n")
  );
});

test("nonmatching and self-authored deposits do not render", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "madrid.md",
    [
      "---",
      "knowstr_doc_id: alice-madrid",
      "---",
      "# Alice Madrid <!-- id:alice-madrid-root -->",
      "- [Madrid](#wd:Q2807) <!-- id:alice-madrid-link -->",
      "",
    ].join("\n")
  );
  const bobPath = await fixedWorkspaceWithDocument(
    BOB,
    "barcelona.md",
    [
      "---",
      "knowstr_doc_id: bob-barcelona",
      "---",
      "# Bob Barcelona <!-- id:bob-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:bob-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
  });

  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "madrid.md",
    "alice-madrid",
    "Alice Madrid"
  );
  await publishDocumentThroughApp(
    relayPool,
    bobPath,
    "barcelona.md",
    "bob-barcelona",
    "Bob Barcelona"
  );

  await expectTree(`
Barcelona
  `);
});

test("pulled incoming rows rank by pane-local tag overlap", async () => {
  const relayPool = mockRelayPool();
  const carolPath = await workspaceWithDocument(
    "spray.md",
    [
      "---",
      "knowstr_doc_id: carol-spray",
      "---",
      "# Carol Spray <!-- id:carol-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:carol-link -->",
      "- [Madrid](#wd:Q2807) <!-- id:carol-extra -->",
      "",
    ].join("\n")
  );
  const alicePath = await workspaceWithDocument(
    "focused.md",
    [
      "---",
      "knowstr_doc_id: alice-focused",
      "---",
      "# Alice Focused <!-- id:alice-focused-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:alice-focused-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
  });

  await publishDocumentThroughApp(
    relayPool,
    carolPath,
    "spray.md",
    "carol-spray",
    "Carol Spray"
  );
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "focused.md",
    "alice-focused",
    "Alice Focused"
  );

  await expectTree(`
Barcelona
  [OI] Alice Focused ↩
  [OI] Carol Spray ↩
  `);
});

test("document panes rank matching deposits by reader graph overlap", async () => {
  const relayPool = mockRelayPool();
  const bobPath = knowstrInit({ relays: [RELAY_URL] }).path;
  write(bobPath, "mises.md", "# Ludwig von Mises <!-- id:wd:Q23129 -->\n");
  write(
    bobPath,
    "interests.md",
    [
      "# Interests <!-- id:interests -->",
      "- [Bitcoin](#wd:Q131723) <!-- id:bob-bitcoin -->",
      "- [Money Theory](#wd:Q1) <!-- id:bob-money-theory -->",
      "",
    ].join("\n")
  );
  await knowstrSave(bobPath);
  const broadPath = await workspaceWithDocument(
    "broad.md",
    [
      "---",
      "knowstr_doc_id: broad-mises",
      "---",
      "# Broad Mises <!-- id:broad-root -->",
      "- [Ludwig von Mises](#wd:Q23129) <!-- id:broad-mises-link -->",
      "- [Bitcoin](#wd:Q131723) <!-- id:broad-bitcoin-link -->",
      "- [Money Theory](#wd:Q1) <!-- id:broad-money-link -->",
      "",
    ].join("\n")
  );
  const narrowPath = await workspaceWithDocument(
    "narrow.md",
    [
      "---",
      "knowstr_doc_id: narrow-mises",
      "---",
      "# Narrow Mises <!-- id:narrow-root -->",
      "- [Ludwig von Mises](#wd:Q23129) <!-- id:narrow-mises-link -->",
      "",
    ].join("\n")
  );
  await withNow(10_000, () =>
    publishDocumentThroughApp(
      relayPool,
      broadPath,
      "broad.md",
      "broad-mises",
      "Broad Mises"
    )
  );
  await withNow(20_000, () =>
    publishDocumentThroughApp(
      relayPool,
      narrowPath,
      "narrow.md",
      "narrow-mises",
      "Narrow Mises"
    )
  );

  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: buildNodeRouteUrl("wd:Q23129", LOCAL, {
      scrollToId: undefined,
      fallbackLabel: undefined,
    }),
  });

  await expectTree(`
Ludwig von Mises
  [OI] Broad Mises ↩
  [OI] Narrow Mises ↩
  `);
});

test("live replacement removes visible remote rows and stale events stay ignored", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "live.md",
    [
      "---",
      "knowstr_doc_id: alice-live",
      "---",
      "# Alice Barcelona <!-- id:alice-live-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:alice-live-link -->",
      "",
    ].join("\n")
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
  });

  await withNow(10_000, () =>
    publishDocumentThroughApp(
      relayPool,
      alicePath,
      "live.md",
      "alice-live",
      "Alice Barcelona"
    )
  );
  await expectTree(`
Barcelona
  [OI] Alice Barcelona ↩
  `);

  await withNow(20_000, () =>
    stopPublishingThroughApp(relayPool, alicePath, "live.md", "alice-live")
  );
  await expectTree(`
Barcelona
  `);

  await withNow(5_000, () =>
    publishDocumentThroughApp(
      relayPool,
      alicePath,
      "live.md",
      "alice-live",
      "Alice Barcelona"
    )
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
    defaultRelays: [RELAY_URL],
    initialRoute: "/local/n/wd%3AQ1492?label=Barcelona",
  });
  await waitFor(() => {
    expect(
      relayPool
        .getSubscriptions()
        .some((sub) =>
          sub.filters.some((filter) =>
            filter.kinds?.includes(KIND_KNOWLEDGE_DEPOSIT)
          )
        )
    ).toBe(true);
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

test("a remote child under a shared parent becomes a suggestion", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "topic.md",
    "# Topic <!-- id:topic -->\n"
  );
  const bobPath = await fixedWorkspaceWithDocument(
    BOB,
    "topic.md",
    [
      "---",
      "knowstr_doc_id: bob-topic",
      "---",
      "# Topic <!-- id:topic -->",
      "- Bob child <!-- id:bob-child -->",
      "",
    ].join("\n")
  );
  await renderAppTree({
    path: alicePath,
    relayPool,
    initialRoute: buildNodeRouteUrl("topic", LOCAL, {
      scrollToId: undefined,
      fallbackLabel: undefined,
    }),
  });

  await publishDocumentThroughApp(
    relayPool,
    bobPath,
    "topic.md",
    "bob-topic",
    "Bob child"
  );

  await expectTree(`
Topic
  [S] Bob child
  `);
});

test("deposit routes render Loading until the exact source arrives", async () => {
  const relayPool = mockRelayPool();
  const alicePath = await workspaceWithDocument(
    "route.md",
    [
      "---",
      "knowstr_doc_id: route-doc",
      "---",
      "# Alice Barcelona <!-- id:route-root -->",
      "- [Barcelona](#wd:Q1492) <!-- id:route-link -->",
      "",
    ].join("\n")
  );
  const route = buildCoordinateRouteUrl(
    "deposit",
    {
      eventKind: KIND_KNOWLEDGE_DEPOSIT,
      pubkey: loadCliProfile({ cwd: alicePath }).pubkey,
      dTag: "route-doc",
      relays: [RELAY_URL],
    },
    undefined,
    undefined
  );
  const [bob] = setup([BOB], { relayPool });
  renderApp({
    ...bob(),
    defaultRelays: [RELAY_URL],
    initialRoute: route,
  });

  await screen.findByText("Loading...");
  await publishDocumentThroughApp(
    relayPool,
    alicePath,
    "route.md",
    "route-doc",
    "Alice Barcelona"
  );
  await expectTree(`
[O] Alice Barcelona
  [O] Barcelona
  `);
});

afterEach(() => {
  cleanup();
});
