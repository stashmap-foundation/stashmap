import { Map } from "immutable";
import type { GraphNode } from "../graph/public";
import type { StoredSnapshotRecord } from "./indexedDB";
import { parseStoredDocumentNodes } from "./documentMaterialization";

export function parseSnapshotNodes(
  snapshot: StoredSnapshotRecord
): Map<string, GraphNode> {
  return parseStoredDocumentNodes(snapshot);
}

export function materializeSnapshots(
  snapshots: ReadonlyArray<StoredSnapshotRecord>
): Map<string, Map<string, GraphNode>> {
  return snapshots.reduce(
    (acc, snapshot) => acc.set(snapshot.dTag, parseSnapshotNodes(snapshot)),
    Map<string, Map<string, GraphNode>>()
  );
}
