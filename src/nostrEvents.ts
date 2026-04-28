import { Collection, List, Map } from "immutable";
import { Event, EventTemplate, Filter, UnsignedEvent } from "nostr-tools";
import type { Document, DocumentDelete } from "./core/Document";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { parseDocumentContent } from "./core/markdownNodes";

export function findAllTags(
  event: EventTemplate,
  tag: string
): Array<Array<string>> | undefined {
  const filtered = event.tags.filter(([tagName]) => tagName === tag);
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.map((t) => t.slice(1));
}

export function findTag(event: EventTemplate, tag: string): string | undefined {
  const allTags = findAllTags(event, tag);
  return allTags && allTags[0] && allTags[0][0];
}

export function getEventMs(event: EventTemplate): number {
  const ms = event.tags?.find((t) => t[0] === "ms")?.[1];
  return ms ? Number(ms) : event.created_at * 1000;
}

export function sortEvents<T extends EventTemplate>(events: List<T>): List<T> {
  return events.sortBy(
    (event, index) => [getEventMs(event), index] as [number, number],
    (a, b) => {
      if (a[0] !== b[0]) {
        return a[0] < b[0] ? -1 : 1;
      }
      return a[1] < b[1] ? -1 : 1;
    }
  );
}

function sortEventsDescending<T extends EventTemplate>(
  events: List<T>
): List<T> {
  return events.sortBy(
    (event, index) => [getEventMs(event), index],
    (a, b) => {
      if (a[0] !== b[0]) {
        return a[0] < b[0] ? 1 : -1;
      }
      if (a[0] === b[0]) {
        return a[1] < b[1] ? 1 : -1;
      }
      return 0;
    }
  );
}

export function getMostRecentReplacableEvent<T extends EventTemplate>(
  events: Collection<string, T> | List<T>
): T | undefined {
  const listOfEvents = List.isList(events) ? events : events.toList();
  return sortEventsDescending(listOfEvents).first(undefined);
}

export function sanitizeAuthorsFilter(filter: Filter): Filter {
  const isValidHexPubkey = (value: string): boolean =>
    /^[0-9a-f]{64}$/.test(value);
  return filter.authors
    ? { ...filter, authors: filter.authors.filter(isValidHexPubkey) }
    : filter;
}

export function eventToDocument(
  event: Event | UnsignedEvent
): Document | undefined {
  if (event.kind !== KIND_KNOWLEDGE_DOCUMENT) return undefined;
  const docId = findTag(event, "d");
  if (!docId) return undefined;
  const systemRole = findTag(event, "s");
  return {
    author: event.pubkey as PublicKey,
    docId,
    updatedMs: getEventMs(event),
    content: event.content,
    ...(systemRole === "log" ? { systemRole: "log" as RootSystemRole } : {}),
  };
}

export function eventToDocumentDelete(
  event: Event | UnsignedEvent
): DocumentDelete | undefined {
  if (
    event.kind !== KIND_DELETE ||
    findTag(event, "k") !== `${KIND_KNOWLEDGE_DOCUMENT}`
  ) {
    return undefined;
  }
  const aTag = findTag(event, "a");
  if (!aTag) return undefined;
  const parts = aTag.split(":");
  const author = parts[1] as PublicKey | undefined;
  const docId = parts.slice(2).join(":");
  if (!author || !docId) return undefined;
  return {
    author,
    docId,
    deletedAt: getEventMs(event),
  };
}

export function parseDocumentEvent(
  event: UnsignedEvent,
  options: { docId?: string } = {}
): Map<string, GraphNode> {
  const sTag = findTag(event, "s");
  return parseDocumentContent({
    content: event.content,
    author: event.pubkey as PublicKey,
    docId: options.docId,
    updatedMs: Number(findTag(event, "ms")) || event.created_at * 1000,
    ...(sTag === "log" ? { systemRole: "log" as RootSystemRole } : {}),
  });
}
