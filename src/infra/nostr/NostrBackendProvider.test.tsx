import React from "react";
import { render } from "@testing-library/react";
import { ApiProvider } from "../../Apis";
import { NostrBackendProvider } from "./NostrBackendProvider";
import { Backend, useBackend } from "../../BackendContext";
import { mockRelayPool } from "../../nostrMock.test";
import { mockFinalizeEvent } from "../../utils.test";

function CaptureBackend({
  capture,
}: {
  capture: (b: Backend) => void;
}): JSX.Element {
  const backend = useBackend();
  capture(backend);
  return <div />;
}

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
        nip11: {
          searchDebounce: 0,
          fetchRelayInformation: jest
            .fn()
            .mockReturnValue(Promise.resolve({ suppported_nips: [] })),
        },
        eventLoadingTimeout: 0,
        timeToStorePreLoginEvents: 0,
      }}
    >
      <NostrBackendProvider db={null}>
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
