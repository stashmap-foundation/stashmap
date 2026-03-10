import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { findContacts, findMembers } from "./contacts";
import { findViews, findDocumentRelations } from "./knowledgeEvents";
import { newDB } from "./knowledge";
import {
  ensureRelationNativeFields,
  getRelationDepth,
  shortID,
} from "./connections";
import { findRelays } from "./relayUtils";

export type ProcessedEvents = {
  knowledgeDB: KnowledgeData;
  contacts: Contacts;
  relays: Relays;
  views: Views;
  projectMembers: Members;
};

export function newProcessedEvents(): ProcessedEvents {
  return {
    knowledgeDB: newDB(),
    contacts: Map<PublicKey, Contact>(),
    relays: [],
    views: Map<string, View>(),
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
    views: findViews(events).merge(processed.views),
  };
}

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const contacts = findContacts(authorEvents);
  const documentRelations = findDocumentRelations(authorEvents);
  const baseKnowledgeDBs = Map<PublicKey, KnowledgeData>().set(
    authorEvents.first()?.pubkey as PublicKey,
    {
      ...newDB(),
      relations: documentRelations,
    }
  );
  const relations = documentRelations
    .valueSeq()
    .sortBy((relation) => getRelationDepth(baseKnowledgeDBs, relation))
    .reduce((acc, relation) => {
      const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(
        relation.author,
        {
          ...newDB(),
          relations: acc,
        }
      );
      const normalized = ensureRelationNativeFields(knowledgeDBs, relation);
      return acc.set(shortID(normalized.id), normalized);
    }, Map<string, Relations>());
  const views = findViews(authorEvents);
  const projectMembers = findMembers(authorEvents);
  const knowledgeDB = {
    ...newDB(),
    relations,
  };
  const relays = findRelays(authorEvents);
  return {
    contacts,
    knowledgeDB,
    relays,
    views,
    projectMembers,
  };
}

export function processEvents(
  events: List<UnsignedEvent | Event>
): Map<PublicKey, ProcessedEvents> {
  const groupedByAuthor = events.groupBy((event) => event.pubkey as PublicKey);
  return Map<PublicKey, ProcessedEvents>(
    groupedByAuthor.toArray().map(([author, authorEvents]) => [
      author,
      processEventsByAuthor(List(authorEvents.valueSeq())),
    ])
  );
}
