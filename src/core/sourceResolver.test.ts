import { List, Map } from "immutable";
import { addNodesToGraphIndex, createEmptyGraphIndex } from "../graphIndex";
import {
  buildNodeLookupIndexes,
  resolveNodeReference,
  resolveNodeReferenceFromGraphIndex,
} from "./sourceResolver";
import { plainSpans } from "./nodeSpans";

const LOCAL = "local" as PublicKey;
const SOURCE_A = "source-a" as PublicKey;
const SOURCE_B = "source-b" as PublicKey;

function node(id: ID, author: PublicKey, updated = 1): GraphNode {
  return {
    id,
    root: id,
    author,
    updated,
    children: List<ID>(),
    spans: plainSpans(id),
    relevance: undefined,
  };
}

function db(...nodes: GraphNode[]): KnowledgeData {
  return {
    nodes: Map<ID, GraphNode>(nodes.map((entry) => [entry.id, entry])),
  };
}

test("local scope resolves local nodes before source candidates", () => {
  const localNode = node("shared", LOCAL);
  const sourceNode = node("shared", SOURCE_A);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([
      [LOCAL, db(localNode)],
      [SOURCE_A, db(sourceNode)],
    ]),
    LOCAL
  );

  const resolved = resolveNodeReference(indexes, "shared", { type: "local" });

  expect(resolved?.node).toBe(localNode);
  expect(resolved?.scope).toEqual({ type: "local" });
  expect(resolved?.ambiguous).toBe(false);
});

test("local scope falls back to source candidates with priority and ambiguity", () => {
  const sourceA = node("remote-only", SOURCE_A);
  const sourceB = node("remote-only", SOURCE_B);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([
      [LOCAL, db()],
      [SOURCE_A, db(sourceA)],
      [SOURCE_B, db(sourceB)],
    ]),
    LOCAL,
    [SOURCE_B, SOURCE_A]
  );

  const resolved = resolveNodeReference(indexes, "remote-only", {
    type: "local",
  });

  expect(resolved?.node).toBe(sourceB);
  expect(resolved?.scope).toEqual({ type: "source", sourceId: SOURCE_B });
  expect(resolved?.ambiguous).toBe(true);
  expect(resolved?.candidates.map((candidate) => candidate.sourceId)).toEqual([
    SOURCE_B,
    SOURCE_A,
  ]);
});

test("graph index resolver uses prebuilt source candidates", () => {
  const sourceA = node("remote-only", SOURCE_A);
  const sourceB = node("remote-only", SOURCE_B);
  const graphIndex = addNodesToGraphIndex(
    addNodesToGraphIndex(
      createEmptyGraphIndex(),
      Map<ID, GraphNode>([[sourceA.id, sourceA]])
    ),
    Map<ID, GraphNode>([[sourceB.id, sourceB]])
  );

  const resolved = resolveNodeReferenceFromGraphIndex(
    graphIndex,
    "remote-only",
    { type: "local" },
    LOCAL,
    [SOURCE_B, SOURCE_A]
  );

  expect(resolved?.node).toBe(sourceB);
  expect(resolved?.ambiguous).toBe(true);
  expect(resolved?.candidates.map((candidate) => candidate.sourceId)).toEqual([
    SOURCE_B,
    SOURCE_A,
  ]);
});

test("source scope resolves only inside that source", () => {
  const localNode = node("shared", LOCAL);
  const sourceA = node("shared", SOURCE_A);
  const sourceB = node("shared", SOURCE_B);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([
      [LOCAL, db(localNode)],
      [SOURCE_A, db(sourceA)],
      [SOURCE_B, db(sourceB)],
    ]),
    LOCAL
  );

  const resolved = resolveNodeReference(indexes, "shared", {
    type: "source",
    sourceId: SOURCE_A,
  });

  expect(resolved?.node).toBe(sourceA);
  expect(resolved?.candidates).toEqual([{ sourceId: SOURCE_A, node: sourceA }]);
  expect(resolved?.ambiguous).toBe(false);
});

test("source scope can resolve the local source explicitly", () => {
  const localNode = node("local-only", LOCAL);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([[LOCAL, db(localNode)]]),
    LOCAL
  );

  const resolved = resolveNodeReference(indexes, "local-only", {
    type: "source",
    sourceId: LOCAL,
  });

  expect(resolved?.node).toBe(localNode);
  expect(resolved?.scope).toEqual({ type: "source", sourceId: LOCAL });
  expect(resolved?.ambiguous).toBe(false);
});

test("source scope does not fall back to local or other sources", () => {
  const localNode = node("local-only", LOCAL);
  const sourceB = node("other-source-only", SOURCE_B);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([
      [LOCAL, db(localNode)],
      [SOURCE_A, db()],
      [SOURCE_B, db(sourceB)],
    ]),
    LOCAL
  );

  expect(
    resolveNodeReference(indexes, "local-only", {
      type: "source",
      sourceId: SOURCE_A,
    })
  ).toBeUndefined();
  expect(
    resolveNodeReference(indexes, "other-source-only", {
      type: "source",
      sourceId: SOURCE_A,
    })
  ).toBeUndefined();
});

test("duplicate node ids across sources are represented as candidates", () => {
  const sourceA = node("duplicate", SOURCE_A);
  const sourceB = node("duplicate", SOURCE_B);
  const indexes = buildNodeLookupIndexes(
    Map<PublicKey, KnowledgeData>([
      [LOCAL, db()],
      [SOURCE_A, db(sourceA)],
      [SOURCE_B, db(sourceB)],
    ]),
    LOCAL,
    [SOURCE_A, SOURCE_B]
  );

  expect(indexes.sourceCandidatesById.get("duplicate")).toEqual([
    { sourceId: SOURCE_A, node: sourceA },
    { sourceId: SOURCE_B, node: sourceB },
  ]);
});
