import { Map } from "immutable";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import {
  ALICE,
  BOB,
  findEvent,
  follow,
  renderApp,
  renderTree,
  setup,
  TEST_RELAYS,
  UpdateState,
  type,
} from "./utils.test";
import { createPlan, planPublishRelayMetadata } from "./planner";
import { execute } from "./executor";
import { KIND_VIEWS } from "./nostr";
import { flattenRelays } from "./relays";

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
    ...bob(),
    plan: planPublishRelays,
  });
  renderTree(alice);
  await type(
    "Alice Workspace{Enter}{Tab}Bitcoin{Enter}{Tab}P2P{Enter}Digital Gold{Escape}"
  );
  cleanup();
  return { alice };
}

test("Write views on user relays", async () => {
  const { alice } = await setupTest();
  const aliceData = alice();
  aliceData.relayPool.resetPublishedOnRelays();

  renderApp({
    ...aliceData,
    initialRoute: `/n/${encodeURIComponent("Alice Workspace")}`,
  });

  const collapseButton = await screen.findByLabelText(
    "collapse Alice Workspace",
    undefined,
    { timeout: 5000 }
  );
  fireEvent.click(collapseButton);
  await findEvent(aliceData.relayPool, { kinds: [KIND_VIEWS] });
  const publishedRelays = aliceData.relayPool.getPublishedOnRelays();
  TEST_RELAYS.forEach((relay) => {
    expect(publishedRelays).toContain(relay.url);
  });
});
