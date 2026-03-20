import type { StoredSnapshotRecord } from "./indexedDB";
import {
  parseSnapshotNodes,
  materializeSnapshots,
} from "./snapshotMaterialization";

const ALICE = "alice" as PublicKey;

test("parseSnapshotNodes produces GraphNode map from markdown", () => {
  const snapshot: StoredSnapshotRecord = {
    replaceableKey: "34773:alice:snap-1",
    author: ALICE,
    eventId: "snap-evt-1",
    dTag: "snap-1",
    sourceRootShortID: "root-short",
    createdAt: 100,
    updatedMs: 100_000,
    content: "# Vacation\n- Spain\n- France",
    tags: [
      ["d", "snap-1"],
      ["source", "root-short"],
      ["ms", "100000"],
    ],
  };

  const nodes = parseSnapshotNodes(snapshot);
  expect(nodes.size).toBeGreaterThanOrEqual(3);

  const nodeTexts = nodes
    .valueSeq()
    .map((n) => n.text)
    .toSet();
  expect(nodeTexts.has("Vacation")).toBe(true);
  expect(nodeTexts.has("Spain")).toBe(true);
  expect(nodeTexts.has("France")).toBe(true);
});

test("materializeSnapshots keys results by dTag", () => {
  const snap1: StoredSnapshotRecord = {
    replaceableKey: "34773:alice:snap-1",
    author: ALICE,
    eventId: "snap-evt-1",
    dTag: "snap-1",
    sourceRootShortID: "root-1",
    createdAt: 100,
    updatedMs: 100_000,
    content: "# Root1\n- A",
    tags: [
      ["d", "snap-1"],
      ["source", "root-1"],
      ["ms", "100000"],
    ],
  };
  const snap2: StoredSnapshotRecord = {
    replaceableKey: "34773:alice:snap-2",
    author: ALICE,
    eventId: "snap-evt-2",
    dTag: "snap-2",
    sourceRootShortID: "root-2",
    createdAt: 200,
    updatedMs: 200_000,
    content: "# Root2\n- B",
    tags: [
      ["d", "snap-2"],
      ["source", "root-2"],
      ["ms", "200000"],
    ],
  };

  const result = materializeSnapshots([snap1, snap2]);
  expect(result.has("snap-1")).toBe(true);
  expect(result.has("snap-2")).toBe(true);
  expect(result.size).toBe(2);
});
