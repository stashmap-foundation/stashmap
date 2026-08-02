import React from "react";
import fs from "fs";
import os from "os";
import path from "path";
import { screen, waitFor } from "@testing-library/react";
import { Event, nip44 } from "nostr-tools";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { loadCliProfile } from "../cli/config";
import { mockRelayPool } from "../nostrMock.test";
import {
  ALICE,
  ALICE_PRIVATE_KEY,
  RootViewOrPaneIsLoading,
  TEST_RELAYS,
  renderWithTestData,
  setup,
  type as typeText,
} from "../utils.test";
import { RelaysWrapper } from "./Relays";
import { PaneView } from "./Workspace";
import { useBackend } from "../BackendContext";
import {
  CONFIG_RELAYS,
  DEFAULT_STORAGE_RELAYS,
  KIND_KNOWLEDGE_DEPOSIT,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_SETTINGS,
} from "../nostr";
import {
  decryptWorkspaceConfigEvent,
  selectLatestWorkspaceConfigEvent,
} from "../workspaceConfig";

function localWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-settings-"));
}

function WorkspaceConfigProbe(): JSX.Element {
  const { workspaceConfig } = useBackend();
  return <div aria-label="workspace room">{workspaceConfig.roomRelays}</div>;
}

async function addRelay(
  channel: "storage" | "room",
  url: string
): Promise<void> {
  await userEvent.type(screen.getByLabelText(`add ${channel} relay`), url);
  await userEvent.click(screen.getByLabelText(`save ${channel} relay`));
}

test("filesystem settings bind a room with the exact profile shape", async () => {
  const workspaceDir = localWorkspace();
  const { relayPool } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });

  expect(screen.queryByLabelText("add storage relay")).toBeNull();
  await addRelay("room", "wss://one.example/");
  await addRelay("room", "wss://two.example/");
  await userEvent.click(screen.getByText("Save"));

  await waitFor(() => {
    expect(loadCliProfile({ cwd: workspaceDir }).workspaceConfig).toEqual({
      storageRelays: [],
      roomRelays: ["wss://one.example/", "wss://two.example/"],
    });
  });
  expect(
    JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, ".knowstr", "profile.json"),
        "utf8"
      )
    )
  ).toEqual({
    nsec_file: "./.knowstr/me.nsec",
    shared: {
      relays: ["wss://one.example/", "wss://two.example/"],
    },
  });
  expect(
    fs.statSync(path.join(workspaceDir, ".knowstr", "me.nsec")).mode % 0o1000
  ).toBe(0o600);
  expect(relayPool.getEvents()).toEqual([]);
});

test("web settings publish encrypted configuration only to configuration relays", async () => {
  const [alice] = setup([ALICE]);
  const view = renderWithTestData(<RelaysWrapper />, {
    ...alice(),
    initialRoute: "/relays",
    storageRelays: DEFAULT_STORAGE_RELAYS,
  });

  DEFAULT_STORAGE_RELAYS.forEach((url) => {
    expect(screen.getByLabelText(`storage relay ${url}`)).toBeDefined();
  });
  await addRelay("storage", "wss://storage.extra/");
  await addRelay("room", "wss://room.example/");
  await userEvent.click(screen.getByText("Save"));

  await waitFor(() => {
    expect(
      view.relayPool.getEvents().filter((event) => event.kind === KIND_SETTINGS)
    ).toHaveLength(1);
  });
  const event = view.relayPool
    .getEvents()
    .find((candidate) => candidate.kind === KIND_SETTINGS);
  if (!event) {
    throw new Error("Missing workspace configuration event");
  }
  expect(event.relays).toEqual(CONFIG_RELAYS);
  expect(event.tags).toEqual([]);
  expect(event).not.toHaveProperty("route");
  const conversationKey = nip44.v2.utils.getConversationKey(
    ALICE_PRIVATE_KEY,
    ALICE.publicKey
  );
  expect(JSON.parse(nip44.v2.decrypt(event.content, conversationKey))).toEqual({
    storage_relays: [...DEFAULT_STORAGE_RELAYS, "wss://storage.extra/"],
    shared: { relays: ["wss://room.example/"] },
  });
  await expect(
    decryptWorkspaceConfigEvent(ALICE, { ...event, content: "malformed" })
  ).resolves.toBeUndefined();
  const invalidSignature: Event = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: "0".repeat(128),
  };
  await expect(
    decryptWorkspaceConfigEvent(ALICE, invalidSignature)
  ).resolves.toBeUndefined();
  await expect(decryptWorkspaceConfigEvent(ALICE, event)).resolves.toEqual({
    storageRelays: [...DEFAULT_STORAGE_RELAYS, "wss://storage.extra/"],
    roomRelays: ["wss://room.example/"],
  });

  expect(
    selectLatestWorkspaceConfigEvent([
      { ...event, id: "f".repeat(64) },
      { ...event, id: "0".repeat(64) },
    ])?.id
  ).toBe("0".repeat(64));

  view.unmount();
  const dateNow = jest
    .spyOn(Date, "now")
    .mockReturnValue((event.created_at + 1) * 1000);
  const { unmount: unmountReload } = renderWithTestData(<RelaysWrapper />, {
    ...alice(),
    relayPool: view.relayPool,
    initialRoute: "/relays",
    storageRelays: DEFAULT_STORAGE_RELAYS,
  });
  await screen.findByLabelText("storage relay wss://storage.extra/");
  await screen.findByLabelText("room relay wss://room.example/");
  await userEvent.click(
    screen.getByLabelText("delete room relay wss://room.example/")
  );
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => {
    expect(
      view.relayPool
        .getEvents()
        .filter((candidate) => candidate.kind === KIND_SETTINGS)
    ).toHaveLength(2);
  });

  const replacement = selectLatestWorkspaceConfigEvent(
    view.relayPool
      .getEvents()
      .filter((candidate) => candidate.kind === KIND_SETTINGS)
  );
  if (!replacement) {
    throw new Error("Missing replacement workspace configuration event");
  }
  expect(
    JSON.parse(nip44.v2.decrypt(replacement.content, conversationKey))
  ).toEqual({
    storage_relays: [...DEFAULT_STORAGE_RELAYS, "wss://storage.extra/"],
  });
  await expect(
    decryptWorkspaceConfigEvent(ALICE, replacement)
  ).resolves.toEqual({
    storageRelays: [...DEFAULT_STORAGE_RELAYS, "wss://storage.extra/"],
    roomRelays: [],
  });

  unmountReload();
  renderWithTestData(<RelaysWrapper />, {
    ...alice(),
    relayPool: view.relayPool,
    initialRoute: "/relays",
    storageRelays: DEFAULT_STORAGE_RELAYS,
  });
  await screen.findByLabelText("storage relay wss://storage.extra/");
  expect(screen.queryByLabelText("room relay wss://room.example/")).toBeNull();
  dateNow.mockRestore();
});

test("web settings keep the default profile after total failure and retry", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation();
  const relayPool = mockRelayPool();
  const publish = jest
    .spyOn(relayPool, "publish")
    .mockImplementation((relays) =>
      relays.map(() => Promise.reject(new Error("connection refused")))
    );
  const [alice] = setup([ALICE], { relayPool });
  renderWithTestData(
    <>
      <WorkspaceConfigProbe />
      <RelaysWrapper />
    </>,
    { ...alice(), relayPool, initialRoute: "/relays" }
  );
  await addRelay("room", "wss://room.example/");
  await userEvent.click(screen.getByText("Save"));

  await screen.findByText(new RegExp(`Failed to publish on: ${CONFIG_RELAYS}`));
  expect(screen.getByLabelText("workspace room").textContent).toBe("");
  expect(relayPool.getEvents()).toEqual([]);

  publish.mockRestore();
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => {
    expect(
      relayPool.getEvents().some((event) => event.kind === KIND_SETTINGS)
    ).toBe(true);
  });
  consoleError.mockRestore();
});

test("web settings report unavailable extension encryption", async () => {
  const [alice] = setup([{ publicKey: ALICE.publicKey }]);
  const { relayPool } = renderWithTestData(<RelaysWrapper />, {
    ...alice(),
    initialRoute: "/relays",
    storageRelays: DEFAULT_STORAGE_RELAYS,
  });

  await userEvent.click(screen.getByText("Save"));
  await screen.findByText("NIP-44 encryption permission unavailable");
  expect(relayPool.getEvents()).toEqual([]);
});

test("web saves route storage and canonical deposits independently", async () => {
  const roomRelay = "wss://room.example/";
  const [alice] = setup([ALICE]);
  const { relayPool: settingsRelayPool, unmount: unmountSettings } =
    renderWithTestData(<RelaysWrapper />, {
      ...alice(),
      initialRoute: "/relays",
    });
  await addRelay("room", roomRelay);
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => {
    expect(
      settingsRelayPool
        .getEvents()
        .some((event) => event.kind === KIND_SETTINGS)
    ).toBe(true);
  });
  unmountSettings();

  const { relayPool } = renderWithTestData(
    <>
      <WorkspaceConfigProbe />
      <RootViewOrPaneIsLoading>
        <PaneView />
      </RootViewOrPaneIsLoading>
    </>,
    { ...alice(), relayPool: settingsRelayPool }
  );
  await screen.findByText(roomRelay);
  await typeText(
    "Room Note{Enter}{Tab}rgb:cdtFZh2Q-YTY1rYW-yBdMlZb-GbkThw~-ArYpJ72-eXiti5Y{Escape}"
  );
  await waitFor(() => {
    expect(
      relayPool
        .getEvents()
        .some((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT)
    ).toBe(true);
  });

  const deposit = relayPool
    .getEvents()
    .filter((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT)
    .at(-1);
  const storage = relayPool
    .getDecryptedEvents()
    .filter((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
    .at(-1);
  const storageWire = relayPool
    .getEvents()
    .filter((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
    .at(-1);
  if (!deposit || !storage || !storageWire) {
    throw new Error("Missing routed document events");
  }
  expect(deposit.relays).toEqual([roomRelay]);
  expect(storageWire.relays).toEqual(TEST_RELAYS.map((relay) => relay.url));
  expect(deposit.content).toBe(storage.content);
  expect(deposit.tags[0]?.[0]).toBe("d");
  expect(deposit.tags.some((tag) => tag[0] === "ms")).toBe(false);
  expect(deposit.tags).toContainEqual([
    "S",
    "asset:rgb:cdtFZh2Q-YTY1rYW-yBdMlZb-GbkThw~-ArYpJ72-eXiti5Y",
  ]);
});

test("web saves emit no deposit without a room", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    { ...alice(), storageRelays: DEFAULT_STORAGE_RELAYS }
  );

  await typeText("Private Note{Escape}");
  await waitFor(() => {
    expect(
      relayPool
        .getEvents()
        .some((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
    ).toBe(true);
  });
  expect(
    relayPool.getEvents().some((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT)
  ).toBe(false);
  const storage = relayPool
    .getEvents()
    .find((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT);
  expect(storage?.relays).toEqual(DEFAULT_STORAGE_RELAYS);
  expect(JSON.parse(storage?.content ?? "")).toEqual({
    key: expect.any(String),
    data: expect.any(String),
  });
});

test("filesystem settings reload, edit, and remove the room", async () => {
  const workspaceDir = localWorkspace();
  const { unmount: unmountFirst } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });
  await addRelay("room", "wss://old.example/");
  await userEvent.click(screen.getByText("Save"));
  const nsecPath = path.join(workspaceDir, ".knowstr", "me.nsec");
  await waitFor(() => expect(fs.existsSync(nsecPath)).toBe(true));
  const nsec = fs.readFileSync(nsecPath, "utf8");
  unmountFirst();

  const { unmount: unmountSecond } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });
  await screen.findByLabelText("room relay wss://old.example/");
  await userEvent.click(
    screen.getByLabelText("delete room relay wss://old.example/")
  );
  await addRelay("room", "wss://new.example/");
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() =>
    expect(
      loadCliProfile({ cwd: workspaceDir }).workspaceConfig.roomRelays
    ).toEqual(["wss://new.example/"])
  );
  unmountSecond();

  await renderAppTree({ path: workspaceDir, initialRoute: "/relays" });
  await screen.findByLabelText("room relay wss://new.example/");
  await userEvent.click(
    screen.getByLabelText("delete room relay wss://new.example/")
  );
  await userEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      fs.existsSync(path.join(workspaceDir, ".knowstr", "profile.json"))
    ).toBe(false)
  );
  expect(fs.readFileSync(nsecPath, "utf8")).toBe(nsec);
});
