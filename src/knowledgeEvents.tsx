import { List, Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { findTag, getEventMs, sortEvents } from "./nostrEvents";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "./nostr";
import { splitID } from "./connections";
import { parseDocumentEvent } from "./markdownRelations";

export function findDocumentRelations(
  events: List<UnsignedEvent>
): Map<string, Relations> {
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
    .filter((event): event is UnsignedEvent => event !== undefined)
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
  }, Map<string, Relations>());
}
