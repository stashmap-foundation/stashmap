import { List, Map } from "immutable";
import { computeVersionDiff, isForkEdge } from "./snapshotBaseline";
import { ResolvedNode } from "./graphLookup";
import { LOCAL } from "./nodeRef";
import { plainSpans } from "./nodeSpans";

const SNAP = "snap_sha256_test";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: id as ID,
    spans: plainSpans(id),
    children: List<ID>(),
    updated: 1,
    root: id as ID,
    relevance: undefined,
    ...overrides,
  };
}

function withChildren(parent: GraphNode, children: GraphNode[]): GraphNode {
  return { ...parent, children: List(children.map((c) => c.id)) };
}

function resolved(graphNode: GraphNode): ResolvedNode {
  return { ref: { sourceId: LOCAL, id: graphNode.id }, node: graphNode };
}

function dbOf(nodes: GraphNode[]): KnowledgeDBs {
  return Map<SourceId, KnowledgeData>({
    [LOCAL]: { nodes: Map(nodes.map((n) => [n.id, n])) },
  });
}

function snapshotOf(nodes: GraphNode[]): SnapshotNodes {
  return Map<string, Map<string, GraphNode>>({
    [SNAP]: Map(nodes.map((n) => [n.id as string, n])),
  });
}

test("baselined edge: fork additions and source deletions have direction", () => {
  const barcelona = node("barcelona");
  const paris = node("paris");
  const original = withChildren(node("original"), [barcelona, paris]);

  const barcelonaCopy = node("barcelona-copy", { basedOn: "barcelona" as ID });
  const vienna = node("vienna");
  const fork = withChildren(
    node("fork", { basedOn: "original" as ID, snapshotId: SNAP }),
    [barcelonaCopy, vienna]
  );

  const snapshotOriginal = withChildren(node("original"), [barcelona]);
  const snapshots = snapshotOf([snapshotOriginal, barcelona]);
  const dbs = dbOf([original, fork, barcelona, paris, barcelonaCopy, vienna]);

  const diff = computeVersionDiff(
    snapshots,
    dbs,
    resolved(original),
    resolved(fork)
  );
  expect(diff?.direct).toBe(false);
  expect(diff?.additions.map((n) => n.id).toArray()).toEqual(["vienna"]);
  expect(diff?.deletions.map((n) => n.id).toArray()).toEqual([]);
});

test("edge without resolvable baseline: direct diff, silent when equal", () => {
  const barcelona = node("barcelona");
  const original = withChildren(node("original"), [barcelona]);
  const barcelonaCopy = node("barcelona-copy", { basedOn: "barcelona" as ID });
  const unchangedFork = withChildren(
    node("fork", { basedOn: "original" as ID }),
    [barcelonaCopy]
  );
  const dbs = dbOf([original, unchangedFork, barcelona, barcelonaCopy]);
  const empty = Map<string, Map<string, GraphNode>>();

  const diff = computeVersionDiff(
    empty,
    dbs,
    resolved(original),
    resolved(unchangedFork)
  );
  expect(diff?.direct).toBe(true);
  expect(diff?.additions.size).toBe(0);
  expect(diff?.deletions.size).toBe(0);

  const vienna = node("vienna");
  const driftedFork = withChildren(unchangedFork, [barcelonaCopy, vienna]);
  const drifted = computeVersionDiff(
    empty,
    dbOf([original, driftedFork, barcelona, barcelonaCopy, vienna]),
    resolved(original),
    resolved(driftedFork)
  );
  expect(drifted?.direct).toBe(true);
  expect((drifted?.additions.size ?? 0) + (drifted?.deletions.size ?? 0)).toBe(
    1
  );
});

test("skip-generation pair is suppressed", () => {
  const gen0 = node("gen0");
  const gen1 = node("gen1", { basedOn: "gen0" as ID });
  const gen2 = node("gen2", { basedOn: "gen1" as ID, snapshotId: SNAP });

  expect(isForkEdge(gen2, gen1)).toBe(true);
  expect(isForkEdge(gen2, gen0)).toBe(false);
  expect(
    computeVersionDiff(
      snapshotOf([gen1]),
      dbOf([gen0, gen1, gen2]),
      resolved(gen2),
      resolved(gen0)
    )
  ).toBeUndefined();
});
