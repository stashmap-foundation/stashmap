import { waitFor } from "@testing-library/react";
import { ALICE, renderTree, setup } from "./utils.test";
import { KIND_CONTACTLIST, KIND_SETTINGS, KIND_VIEWS } from "./nostr";

test("meta query uses separate filters with limit 1 for each replaceable kind", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderTree(alice);

  await waitFor(() => {
    const allFilters = relayPool
      .getSubscriptions()
      .flatMap((s) => s.filters);

    const metaKinds = [KIND_SETTINGS, KIND_CONTACTLIST, KIND_VIEWS];
    metaKinds.forEach((kind) => {
      const matching = allFilters.filter(
        (f) => f.kinds?.length === 1 && f.kinds[0] === kind && f.limit === 1
      );
      expect(matching.length).toBeGreaterThanOrEqual(1);
    });
  });
});
