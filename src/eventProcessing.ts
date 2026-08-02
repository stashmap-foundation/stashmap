import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { buildKnowledgeDBFromDocumentEvents } from "./documentMaterialization";
import { newDB } from "./core/knowledge";

type ProcessedEvents = {
  knowledgeDB: KnowledgeData;
};

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const author = authorEvents.first()?.pubkey as PublicKey | undefined;
  const knowledgeDB =
    author && buildKnowledgeDBFromDocumentEvents(author, authorEvents);
  return { knowledgeDB: knowledgeDB || newDB() };
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
