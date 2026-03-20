import { Map } from "immutable";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import {
  ALICE,
  BOB,
  follow,
  renderApp,
  renderTree,
  setup,
  UpdateState,
  type,
} from "../testutils";
import { createPlan } from "../../usecases/session/actions";
import { execute, planPublishRelayMetadata } from "../../infra/nostr";
import type { Relays } from "../../infra/publishTypes";
import { flattenRelays } from "../../infra/relayUtils";

test("Flatten relays", () => {
  expect(
    flattenRelays(
      Map<PublicKey, Relays>({
        [ALICE.publicKey]: [
          { url: "wss://winchester.deedsats.com/", read: true, write: true },
          { url: "wss://alice.deedsats.com/", read: true, write: true },
        ],
        [BOB.publicKey]: [
          { url: "wss://bob.deedsats.com/", read: true, write: true },
        ],
      })
    )
  ).toEqual([
    { url: "wss://winchester.deedsats.com/", read: true, write: true },
    { url: "wss://alice.deedsats.com/", read: true, write: true },
    { url: "wss://bob.deedsats.com/", read: true, write: true },
  ]);
});

async function setupTest(): Promise<{
  alice: UpdateState;
}> {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  const planPublishRelays = planPublishRelayMetadata(createPlan(bob()), [
    { url: "wss://relay.bob.lol/", read: true, write: true },
  ]);
  await execute({
    events: planPublishRelays.publishEvents,
    user: planPublishRelays.user,
    relays: bob().relays,
    relayPool: bob().relayPool,
    finalizeEvent: bob().finalizeEvent,
  });
  renderTree(alice);
  await type(
    "Alice Workspace{Enter}{Tab}Bitcoin{Enter}{Tab}P2P{Enter}Digital Gold{Escape}"
  );
  cleanup();
  return { alice };
}

test("Store views locally instead of writing on relays", async () => {
  const { alice } = await setupTest();
  const aliceData = alice();
  aliceData.relayPool.resetPublishedOnRelays();
  localStorage.clear();

  const route = `/n/${encodeURIComponent("Alice Workspace")}`;

  renderApp({
    ...aliceData,
    initialRoute: route,
  });

  const collapseButton = await screen.findByLabelText(
    "collapse Alice Workspace",
    undefined,
    { timeout: 5000 }
  );
  fireEvent.click(collapseButton);

  await screen.findByLabelText("expand Alice Workspace");
  expect(aliceData.relayPool.getPublishedOnRelays()).toEqual([]);

  cleanup();

  renderApp({
    ...aliceData,
    initialRoute: route,
  });

  await screen.findByLabelText("expand Alice Workspace");
  expect(screen.queryByLabelText("collapse Alice Workspace")).toBeNull();
});
