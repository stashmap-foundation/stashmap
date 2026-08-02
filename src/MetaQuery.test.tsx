import { waitFor } from "@testing-library/react";
import { ALICE, renderTree, setup, TEST_RELAYS } from "./utils.test";
import { CONFIG_RELAYS, KIND_SETTINGS } from "./nostr";

test("workspace configuration reads only from configuration relays", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderTree(alice);

  await waitFor(() => {
    const subscriptions = relayPool.getSubscriptions();
    const matching = subscriptions.filter((subscription) =>
      subscription.filters.some(
        (filter) =>
          filter.kinds?.length === 1 &&
          filter.kinds[0] === KIND_SETTINGS &&
          filter.limit === 1
      )
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]?.relays).toEqual(CONFIG_RELAYS);
    expect(
      subscriptions.some((subscription) =>
        subscription.filters.some((filter) => filter.kinds?.includes(10002))
      )
    ).toBe(false);
    const storage = subscriptions.find((subscription) =>
      subscription.filters.some(
        (filter) =>
          filter.kinds?.includes(34775) &&
          filter.authors?.includes(ALICE.publicKey)
      )
    );
    expect(storage?.relays).toEqual(
      TEST_RELAYS.map((relay) => relay.url).sort()
    );
  });
});
