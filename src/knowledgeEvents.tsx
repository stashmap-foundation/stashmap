import { List, Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { findTag, sortEvents } from "./commons/useNostrQuery";
import {
  KIND_DELETE,
  KIND_PROJECT,
  KIND_KNOWLEDGE_LIST,
  KIND_KNOWLEDGE_NODE,
  KIND_WORKSPACE,
} from "./nostr";
import {
  eventToRelations,
  eventToTextOrProjectNode,
  eventToWorkspace,
} from "./serializer";
import { splitID } from "./connections";

function isTextNodeOrProject(kind: number | string): boolean {
  const kindAsNumber = typeof kind === "string" ? parseInt(kind, 10) : kind;
  return kindAsNumber === KIND_KNOWLEDGE_NODE || kindAsNumber === KIND_PROJECT;
}

// Only listen to delete events where the signer created the node or relation
function isDeletable(
  event: UnsignedEvent | undefined,
  nodes: Map<string, { id: LongID }>
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
      (event) => isTextNodeOrProject(event.kind) || event.kind === KIND_DELETE
    )
  );
  // use reduce in case of duplicate nodes, the newer version wins
  return sorted.reduce((rdx, event) => {
    if (event.kind === KIND_DELETE) {
      const [deletable, eventToDeleteId, deleteKind] = isDeletable(event, rdx);
      if (deletable && isTextNodeOrProject(deleteKind)) {
        return rdx.remove(eventToDeleteId);
      }
      return rdx;
    }
    const [id, node] = eventToTextOrProjectNode(event);
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

export function findWorkspaces(events: List<UnsignedEvent>): Workspaces {
  const sorted = sortEvents(
    events.filter(
      (event) => event.kind === KIND_WORKSPACE || event.kind === KIND_DELETE
    )
  );
  return sorted.reduce((rdx, event) => {
    if (event.kind === KIND_DELETE) {
      const [deletable, eventToDeleteId, deleteKind] = isDeletable(event, rdx);
      if (deletable && `${deleteKind}` === `${KIND_WORKSPACE}`) {
        return rdx.remove(eventToDeleteId);
      }
      return rdx;
    }
    const [id, workspace] = eventToWorkspace(event);
    return id
      ? rdx.set(id, {
          node: workspace.node,
          id: workspace.id,
          project: undefined,
          views: workspace.views,
        })
      : rdx;
  }, Map<ID, Workspace>());
}

function getViewsFromWorkspaces(workspaces: Workspaces): Views {
  return workspaces.reduce((rdx, ws) => {
    return ws.views !== undefined ? rdx.merge(ws.views) : rdx;
  }, Map<string, View>());
}

export function findViews(events: List<UnsignedEvent>): Views {
  const workspaces = findWorkspaces(events);
  return getViewsFromWorkspaces(workspaces);
}
