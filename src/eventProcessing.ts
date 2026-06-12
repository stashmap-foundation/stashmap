import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { buildKnowledgeDBFromDocumentEvents } from "./documentMaterialization";
import { newDB } from "./core/knowledge";
import { findRelays } from "./relayUtils";

type ProcessedEvents = {
  knowledgeDB: KnowledgeData;
  relays: Relays;
};

export function newProcessedEvents(): ProcessedEvents {
  return {
    knowledgeDB: newDB(),
    relays: [],
  };
}

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const author = authorEvents.first()?.pubkey as PublicKey | undefined;
  const knowledgeDB =
    author && buildKnowledgeDBFromDocumentEvents(author, authorEvents);
  const relays = findRelays(authorEvents);
  return {
    knowledgeDB: knowledgeDB || newDB(),
    relays,
  };
}

export function processEvents(
  events: List<UnsignedEvent | Event>
): Map<PublicKey, ProcessedEvents> {
  const groupedByAuthor = events.groupBy((event) => event.pubkey as PublicKey);
  return Map<PublicKey, ProcessedEvents>(
    groupedByAuthor
      .toArray()
      .map(([author, authorEvents]) => [
        author,
        processEventsByAuthor(List(authorEvents.valueSeq())),
      ])
  );
}
