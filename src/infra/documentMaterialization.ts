import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { ensureNodeNativeFields } from "../graph/queries";
import { getNodeDepth, shortID, splitID } from "../graph/context";
import { newDB } from "../graph/types";
import type { StoredDocumentRecord } from "../indexedDB";
import { parseDocumentEvent } from "./markdownNodes";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "../nostr";
import { findTag, getEventMs, sortEvents } from "../nostrEvents";

export function storedDocumentToEvent(
  document: StoredDocumentRecord
): UnsignedEvent {
  return {
    pubkey: document.author,
    created_at: document.createdAt,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    tags: document.tags,
    content: document.content,
  };
}

export function findDocumentNodes(
  events: List<UnsignedEvent | Event>
): Map<string, GraphNode> {
  const deletedKeys = events
    .filter(
      (event) =>
        event.kind === KIND_DELETE &&
        findTag(event, "k") === `${KIND_KNOWLEDGE_DOCUMENT}`
    )
    .reduce((acc, event) => {
      const key = findTag(event, "a");
      if (!key) {
        return acc;
      }
      const deletedAt = getEventMs(event);
      const existing = acc.get(key);
      if (!existing || deletedAt > existing) {
        return acc.set(key, deletedAt);
      }
      return acc;
    }, Map<string, number>());

  const docEvents = sortEvents(
    events.filter((event) => {
      if (event.kind !== KIND_KNOWLEDGE_DOCUMENT) {
        return false;
      }
      const replaceableKey = getReplaceableKey(event);
      if (!replaceableKey) {
        return false;
      }
      const deletedAt = deletedKeys.get(replaceableKey);
      return deletedAt === undefined || getEventMs(event) > deletedAt;
    })
  );

  const deduped = docEvents
    .groupBy((event) => getReplaceableKey(event) ?? "")
    .map((group) => group.last())
    .valueSeq()
    .filter((event): event is UnsignedEvent | Event => event !== undefined)
    .toList();

  const parsedNodes = sortEvents(deduped)
    .flatMap((event) => parseDocumentEvent(event).valueSeq())
    .toList();

  return parsedNodes.reduce((acc, node) => {
    const id = splitID(node.id)[1];
    const existing = acc.get(id);
    if (!existing || node.updated >= existing.updated) {
      return acc.set(id, node);
    }
    return acc;
  }, Map<string, GraphNode>());
}

export function buildKnowledgeDBFromDocumentNodes(
  author: PublicKey,
  documentNodes: Map<string, GraphNode>
): KnowledgeData | undefined {
  if (documentNodes.size === 0) {
    return undefined;
  }

  const baseKnowledgeDBs = Map<PublicKey, KnowledgeData>().set(author, {
    ...newDB(),
    nodes: documentNodes,
  });

  const nodes = documentNodes
    .valueSeq()
    .sortBy((node) => getNodeDepth(baseKnowledgeDBs, node))
    .reduce((acc, node) => {
      const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(node.author, {
        ...newDB(),
        nodes: acc,
      });
      const normalized = ensureNodeNativeFields(knowledgeDBs, node);
      return acc.set(shortID(normalized.id), normalized);
    }, Map<string, GraphNode>());

  return {
    ...newDB(),
    nodes,
  };
}

export function buildKnowledgeDBFromDocumentEvents(
  author: PublicKey,
  events: List<UnsignedEvent | Event>
): KnowledgeData | undefined {
  return buildKnowledgeDBFromDocumentNodes(author, findDocumentNodes(events));
}
