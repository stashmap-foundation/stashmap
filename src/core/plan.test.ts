import { List, Map } from "immutable";
import { createEmptyGraphData, nodeKeyOf } from "./graphData";
import { createRefTarget } from "./connections";
import { newGraphNode } from "./nodeFactory";
import { plainSpans } from "./nodeSpans";
import {
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planCopyDescendantNodes,
  planUpsertNodes,
  withDocumentRoot,
} from "./plan";

const LOCAL = "local-user" as PublicKey;

function emptyPlan(): GraphPlan {
  return createGraphPlan({
    contacts: Map<PublicKey, Contact>(),
    user: { publicKey: LOCAL },
    contactsRelays: Map<PublicKey, Relays>(),
    ...createEmptyGraphData(),
    relaysInfos: Map(),
    snapshotNodes: Map(),
    relays: {
      defaultRelays: [],
      userRelays: [],
      contactsRelays: [],
    },
  });
}

test("planner-created refs are immediately visible in canonical incoming indexes", () => {
  const parent = withDocumentRoot(newGraphNode(LOCAL, plainSpans("parent")));
  const target = newGraphNode(LOCAL, plainSpans("target"));
  const plan = planUpsertNodes(planUpsertNodes(emptyPlan(), parent), target);

  const [nextPlan, [refID]] = planAddTargetsToNode(
    plan,
    parent,
    createRefTarget(target.id)
  );

  expect(nextPlan.incomingCrefs.get(nodeKeyOf(LOCAL, target.id))).toContain(
    nodeKeyOf(LOCAL, refID)
  );
});

test("planner-created versions are immediately visible in canonical lineage index", () => {
  const source = withDocumentRoot(newGraphNode(LOCAL, plainSpans("source")));
  const plan = planUpsertNodes(emptyPlan(), source);

  const [nextPlan, mapping] = planCopyDescendantNodes(
    plan,
    source,
    () => List<ID>()
  );
  const copiedID = mapping.get(source.id);

  expect(copiedID).toBeDefined();
  expect(nextPlan.basedOnIndex.get(nodeKeyOf(LOCAL, source.id))).toEqual(
    new Set([nodeKeyOf(LOCAL, copiedID as ID)])
  );
});
