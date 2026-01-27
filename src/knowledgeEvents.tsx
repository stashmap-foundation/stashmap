import { List, Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  findTag,
  getMostRecentReplacableEvent,
  sortEvents,
} from "./commons/useNostrQuery";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_LIST,
  KIND_KNOWLEDGE_NODE,
  KIND_VIEWS,
} from "./nostr";
import {
  Serializable,
  jsonToViews,
  jsonToPanes,
  eventToRelations,
  eventToTextNode,
} from "./serializer";
import { splitID } from "./connections";

function isTextNode(kind: number | string): boolean {
  const kindAsNumber = typeof kind === "string" ? parseInt(kind, 10) : kind;
  return kindAsNumber === KIND_KNOWLEDGE_NODE;
}

// Only listen to delete events where the signer created the node or relation
function isDeletable(
  event: UnsignedEvent | undefined,
  nodes: Map<string, { id: ID }>
): [false] | [true, string, string] {
  if (!event) {
    return [false];
  }
  const deleteTag = findTag(event, "a");
  if (!deleteTag) {
    return [false];
  }
  const [deleteKind, userPublicKey, eventToDeleteId] = deleteTag.split(":");
  const itemToDelete = nodes.get(eventToDeleteId);
  if (!itemToDelete) {
    return [false];
  }
  const isDeletedByAuthor = userPublicKey === splitID(itemToDelete.id)[0];
  if (isDeletedByAuthor && eventToDeleteId) {
    return [true, eventToDeleteId, deleteKind];
  }
  return [false];
}

export function findNodes(events: List<UnsignedEvent>): Map<string, KnowNode> {
  const sorted = sortEvents(
    events.filter(
      (event) => isTextNode(event.kind) || event.kind === KIND_DELETE
    )
  );
  // use reduce in case of duplicate nodes, the newer version wins
  return sorted.reduce((rdx, event) => {
    if (event.kind === KIND_DELETE) {
      const [deletable, eventToDeleteId, deleteKind] = isDeletable(event, rdx);
      if (deletable && isTextNode(deleteKind)) {
        return rdx.remove(eventToDeleteId);
      }
      return rdx;
    }
    const [id, node] = eventToTextNode(event);
    return id ? rdx.set(id, node) : rdx;
  }, Map<string, KnowNode>());
}

export function findRelations(
  events: List<UnsignedEvent>
): Map<string, Relations> {
  const sorted = sortEvents(
    events.filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_LIST || event.kind === KIND_DELETE
    )
  );
  return sorted.reduce((rdx, event) => {
    if (event.kind === KIND_DELETE) {
      const [deletable, eventToDeleteId, deleteKind] = isDeletable(event, rdx);
      if (deletable && deleteKind === `${KIND_KNOWLEDGE_LIST}`) {
        return rdx.remove(eventToDeleteId);
      }
      return rdx;
    }
    const relations = eventToRelations(event);
    if (!relations) {
      return rdx;
    }
    const id = splitID(relations.id)[1];
    return rdx.set(id, relations);
  }, Map<string, Relations>());
}

export function findViews(events: List<UnsignedEvent>): Views {
  const viewEvent = getMostRecentReplacableEvent(
    events.filter((event) => event.kind === KIND_VIEWS)
  );
  if (viewEvent === undefined) {
    return Map<string, View>();
  }
  return jsonToViews(JSON.parse(viewEvent.content) as Serializable);
}

export function findPanes(events: List<UnsignedEvent>): Pane[] {
  const viewEvent = getMostRecentReplacableEvent(
    events.filter((event) => event.kind === KIND_VIEWS)
  );
  if (viewEvent === undefined) {
    return [];
  }
  return jsonToPanes(JSON.parse(viewEvent.content) as Serializable);
}
