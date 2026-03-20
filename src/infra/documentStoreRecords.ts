import { Event, UnsignedEvent } from "nostr-tools";
import type { StoredDeleteRecord, StoredDocumentRecord } from "./indexedDB";
import { toStoredDeleteRecord, toStoredDocumentRecord } from "./permanentSync";

export function eventsToStoredRecords(
  events: ReadonlyArray<Event | UnsignedEvent>
): {
  readonly documents: ReadonlyArray<StoredDocumentRecord>;
  readonly deletes: ReadonlyArray<StoredDeleteRecord>;
} {
  return {
    documents: events
      .map((event) => toStoredDocumentRecord(event))
      .filter((record): record is StoredDocumentRecord => record !== undefined),
    deletes: events
      .map((event) => toStoredDeleteRecord(event))
      .filter((record): record is StoredDeleteRecord => record !== undefined),
  };
}

export function getStoredRecordEventID(
  event: Event | UnsignedEvent
): string | undefined {
  const document = toStoredDocumentRecord(event);
  if (document) {
    return document.eventId;
  }
  return toStoredDeleteRecord(event)?.eventId;
}

export function normalizeCachedEventRecord(
  event: Event | UnsignedEvent
): Record<string, unknown> | undefined {
  if ("id" in event && typeof event.id === "string") {
    return event as unknown as Record<string, unknown>;
  }
  const eventId = getStoredRecordEventID(event);
  return eventId
    ? {
        ...event,
        id: eventId,
      }
    : undefined;
}
