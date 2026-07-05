import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { ensureNodeNativeFields, getNodeDepth } from "./core/connections";
import type { StoredDocumentRecord } from "./infra/nostr/cache/indexedDB";
import { newDB } from "./core/knowledge";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "./nostr";
import { eventToParsed, findTag, getEventMs, sortEvents } from "./nostrEvents";

export function storedDocumentToEvent(
  document: StoredDocumentRecord
): UnsignedEvent & EventAttachment {
  return {
    pubkey: document.author,
    created_at: document.createdAt,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    tags: document.tags,
    content: document.content,
    ...(document.storageKey !== undefined && {
      storageKey: document.storageKey,
    }),
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
    .flatMap<GraphNode>((event) => {
      const parsed = eventToParsed(event);
      return parsed ? parsed.nodes.valueSeq().toList() : List<GraphNode>();
    })
    .toList();

  return parsedNodes.reduce((acc, node) => {
    const existing = acc.get(node.id);
    if (!existing || node.updated >= existing.updated) {
      return acc.set(node.id, node);
    }
    return acc;
  }, Map<string, GraphNode>());
}

export function buildKnowledgeDBFromDocumentNodes(
  author: SourceId,
  documentNodes: Map<string, GraphNode>
): KnowledgeData | undefined {
  if (documentNodes.size === 0) {
    return undefined;
  }

  const baseKnowledgeDBs = Map<SourceId, KnowledgeData>().set(author, {
    ...newDB(),
    nodes: documentNodes,
  });

  const nodes = documentNodes
    .valueSeq()
    .sortBy((node) => getNodeDepth(baseKnowledgeDBs, node, author))
    .reduce((acc, node) => {
      const normalized = ensureNodeNativeFields(
        { ...newDB(), nodes: acc },
        node
      );
      return acc.set(normalized.id, normalized);
    }, Map<string, GraphNode>());

  return {
    ...newDB(),
    nodes,
  };
}

export function buildKnowledgeDBFromDocumentEvents(
  author: SourceId,
  events: List<UnsignedEvent | Event>
): KnowledgeData | undefined {
  return buildKnowledgeDBFromDocumentNodes(author, findDocumentNodes(events));
}
