import React from "react";
import { hexToBytes } from "@noble/hashes/utils";
import { render, waitFor } from "@testing-library/react";
import { ApiProvider } from "../../Apis";
import { NostrBackendProvider } from "./NostrBackendProvider";
import { Backend, useBackend } from "../../BackendContext";
import { mockRelayPool } from "../../nostrMock.test";
import { ALICE, ALICE_PRIVATE_KEY, mockFinalizeEvent } from "../../utils.test";
import {
  buildWorkspaceConfigEvent,
  defaultWebWorkspaceConfig,
} from "../../workspaceConfig";
import { CONFIG_RELAYS } from "../../nostr";

function CaptureBackend({
  capture,
}: {
  capture: (b: Backend) => void;
}): JSX.Element {
  const backend = useBackend();
  capture(backend);
  return <div />;
}

test("NostrBackendProvider loads encrypted workspace configuration", async () => {
  const relayPool = mockRelayPool();
  const unsigned = await buildWorkspaceConfigEvent(ALICE, {
    storageRelays: ["wss://storage.example/"],
    roomRelays: ["wss://room.example/"],
  });
  const { route, storageKey, ...template } = unsigned;
  const event = mockFinalizeEvent()(template, hexToBytes(ALICE_PRIVATE_KEY));
  await Promise.all(relayPool.publish(CONFIG_RELAYS, event));
  const capture = jest.fn<void, [Backend]>();

  render(
    <ApiProvider
      apis={{
        fileStore: {
          setLocalStorage: () => undefined,
          getLocalStorage: (key) =>
            key === "privateKey" ? ALICE_PRIVATE_KEY : null,
          deleteLocalStorage: () => undefined,
        },
        relayPool,
        finalizeEvent: mockFinalizeEvent(),
        eventLoadingTimeout: 0,
      }}
    >
      <NostrBackendProvider
        db={null}
        initialWorkspaceConfig={defaultWebWorkspaceConfig()}
      >
        <CaptureBackend capture={capture} />
      </NostrBackendProvider>
    </ApiProvider>
  );

  await waitFor(() => {
    expect(capture.mock.calls.at(-1)?.[0].workspaceConfig).toEqual({
      storageRelays: ["wss://storage.example/"],
      roomRelays: ["wss://room.example/"],
    });
  });
  expect(route).toEqual({
    kind: "configuration",
    relays: CONFIG_RELAYS,
  });
  expect(storageKey).toBeUndefined();
});

test("NostrBackendProvider exposes subscribe and publish that delegate to relayPool", () => {
  const relayPool = mockRelayPool();
  // eslint-disable-next-line functional/no-let
  let captured: Backend | undefined;
  render(
    <ApiProvider
      apis={{
        fileStore: {
          setLocalStorage: () => undefined,
          getLocalStorage: () => null,
          deleteLocalStorage: () => undefined,
        },
        relayPool,
        finalizeEvent: mockFinalizeEvent(),
        eventLoadingTimeout: 0,
      }}
    >
      <NostrBackendProvider
        db={null}
        initialWorkspaceConfig={defaultWebWorkspaceConfig()}
      >
        <CaptureBackend
          capture={(b) => {
            captured = b;
          }}
        />
      </NostrBackendProvider>
    </ApiProvider>
  );

  expect(captured).toBeDefined();
  const backend = captured as Backend;

  backend.subscribe(["wss://relay.test"], [{ kinds: [1] }], {
    onevent: () => undefined,
    oneose: () => undefined,
  });
  expect(relayPool.getSubscribeManyCalls()).toEqual([
    { relays: ["wss://relay.test"], filters: [{ kinds: [1] }] },
  ]);

  backend.publish(["wss://relay.test"], {
    id: "event".padEnd(64, "0"),
    pubkey: "alice".padEnd(64, "0"),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "",
  });
  expect(relayPool.getPublishedOnRelays()).toEqual(["wss://relay.test"]);
});
