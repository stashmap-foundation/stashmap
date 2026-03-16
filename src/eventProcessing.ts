import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { findContacts, findMembers } from "./contacts";
import { buildKnowledgeDBFromDocumentEvents } from "./documentMaterialization";
import { newDB } from "./knowledge";
import { findRelays } from "./relayUtils";

type ProcessedEvents = {
  knowledgeDB: KnowledgeData;
  contacts: Contacts;
  relays: Relays;
  projectMembers: Members;
};

export function newProcessedEvents(): ProcessedEvents {
  return {
    knowledgeDB: newDB(),
    contacts: Map<PublicKey, Contact>(),
    relays: [],
    projectMembers: Map<PublicKey, Member>(),
  };
}

export function mergeEvents(
  processed: ProcessedEvents,
  events: List<UnsignedEvent | Event>
): ProcessedEvents {
  return {
    ...processed,
    contacts: processed.contacts.merge(findContacts(events)),
  };
}

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const contacts = findContacts(authorEvents);
  const projectMembers = findMembers(authorEvents);
  const author = authorEvents.first()?.pubkey as PublicKey | undefined;
  const knowledgeDB =
    author && buildKnowledgeDBFromDocumentEvents(author, authorEvents);
  const relays = findRelays(authorEvents);
  return {
    contacts,
    knowledgeDB: knowledgeDB || newDB(),
    relays,
    projectMembers,
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
