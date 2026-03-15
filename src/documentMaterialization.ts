import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import {
  ensureNodeNativeFields,
  getNodeDepth,
  shortID,
  splitID,
} from "./connections";
import type { StoredDocumentRecord } from "./indexedDB";
import { newDB } from "./knowledge";
import { parseDocumentEvent } from "./markdownRelations";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "./nostr";
import { findTag, getEventMs, sortEvents } from "./nostrEvents";

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

export function findDocumentRelations(
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

  const parsedRelations = sortEvents(deduped)
    .flatMap((event) => parseDocumentEvent(event).valueSeq())
    .toList();

  return parsedRelations.reduce((acc, relation) => {
    const id = splitID(relation.id)[1];
    const existing = acc.get(id);
    if (!existing || relation.updated >= existing.updated) {
      return acc.set(id, relation);
    }
    return acc;
  }, Map<string, GraphNode>());
}

export function buildKnowledgeDBFromDocumentRelations(
  author: PublicKey,
  documentRelations: Map<string, GraphNode>
): KnowledgeData | undefined {
  if (documentRelations.size === 0) {
    return undefined;
  }

  const baseKnowledgeDBs = Map<PublicKey, KnowledgeData>().set(author, {
    ...newDB(),
    nodes: documentRelations,
  });

  const nodes = documentRelations
    .valueSeq()
    .sortBy((relation) => getNodeDepth(baseKnowledgeDBs, relation))
    .reduce((acc, relation) => {
      const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(
        relation.author,
        {
          ...newDB(),
          nodes: acc,
        }
      );
      const normalized = ensureNodeNativeFields(knowledgeDBs, relation);
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
  return buildKnowledgeDBFromDocumentRelations(
    author,
    findDocumentRelations(events)
  );
}

export function buildKnowledgeDBFromStoredDocuments(
  author: PublicKey,
  documents: ReadonlyArray<StoredDocumentRecord>
): KnowledgeData | undefined {
  if (documents.length === 0) {
    return undefined;
  }

  return buildKnowledgeDBFromDocumentEvents(
    author,
    List(documents.map((document) => storedDocumentToEvent(document)))
  );
}
