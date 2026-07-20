import fs from "fs";
import os from "os";
import path from "path";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BOB, expectTree, renderApp, setup } from "../utils.test";
import { renderAppTree } from "../appTestUtils.test";
import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";
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
  write(bobPath, "mises.md", "# Ludwig von Mises <!-- id:mises -->\n");
  write(
    bobPath,
    "interests.md",
    [
      "# Interests <!-- id:interests -->",
      "- [Bitcoin](#bitcoin) <!-- id:bob-bitcoin -->",
      "- [Money Theory](#money-theory) <!-- id:bob-money-theory -->",
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
      "- [Ludwig von Mises](#mises) <!-- id:broad-mises-link -->",
      "- [Bitcoin](#bitcoin) <!-- id:broad-bitcoin-link -->",
      "- [Money Theory](#money-theory) <!-- id:broad-money-link -->",
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
      "- [Ludwig von Mises](#mises) <!-- id:narrow-mises-link -->",
      "",
    ].join("\n")
  );
  await renderAppTree({
    path: bobPath,
    relayPool,
    initialRoute: buildNodeRouteUrl("mises", LOCAL, {
      scrollToId: undefined,
      fallbackLabel: undefined,
    }),
  });

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
