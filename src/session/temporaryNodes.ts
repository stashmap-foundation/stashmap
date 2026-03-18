import { List, Map } from "immutable";
import type { EmptyNodeDraft, TemporaryEvent } from "./types";

export type EmptyNodeData = {
  index: number;
  emptyNode: EmptyNodeDraft;
  paneIndex: number;
};

export function computeEmptyNodeMetadata(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, EmptyNodeData> {
  return temporaryEvents.reduce((metadata, event) => {
    if (event.type === "ADD_EMPTY_NODE") {
      return metadata.set(event.nodeID, {
        index: event.index,
        emptyNode: event.emptyNode,
        paneIndex: event.paneIndex,
      });
    }
    if (event.type === "REMOVE_EMPTY_NODE") {
      return metadata.delete(event.nodeID);
    }
    return metadata;
  }, Map<LongID, EmptyNodeData>());
}
