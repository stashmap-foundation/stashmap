import { Collection, List } from "immutable";
import { EventTemplate, Filter } from "nostr-tools";

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

export function sortEventsDescending<T extends EventTemplate>(
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
