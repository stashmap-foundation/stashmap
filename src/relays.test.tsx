import { Map } from "immutable";
import { screen, fireEvent } from "@testing-library/react";
import {
  ALICE,
  BOB,
  findEvent,
  findNodeByText,
  follow,
  renderApp,
  setup,
  setupTestDB,
  TEST_RELAYS,
  UpdateState,
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
  bob: UpdateState;
  workspace: KnowNode;
  bitcoin: KnowNode;
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
  const db = await setupTestDB(alice(), [
    ["Alice Workspace", [["Bitcoin", ["P2P", "Digital Gold"]]]],
  ]);
  const workspace = findNodeByText(db, "Alice Workspace") as KnowNode;
  const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;
  return { alice, bob, workspace, bitcoin };
}

test("Write views on user relays", async () => {
  const { alice, workspace } = await setupTest();
  const aliceData = alice();
  aliceData.relayPool.resetPublishedOnRelays();

  renderApp({
    ...aliceData,
    initialRoute: `/w/${workspace.id}`,
  });

  const expandButton = await screen.findByLabelText(
    "expand Alice Workspace",
    undefined,
    { timeout: 5000 }
  );
  fireEvent.click(expandButton);

  const collapseButton = await screen.findByLabelText("collapse Alice Workspace");
  fireEvent.click(collapseButton);
  await findEvent(aliceData.relayPool, { kinds: [KIND_VIEWS] });
  const publishedRelays = aliceData.relayPool.getPublishedOnRelays();
  TEST_RELAYS.forEach((relay) => {
    expect(publishedRelays).toContain(relay.url);
  });
});
