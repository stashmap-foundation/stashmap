import React, { useEffect, useState } from "react";
import "./App.css";
import {
  sortEventsDescending,
  useEventQuery,
  createRelaysQuery,
  findRelays,
  mergeRelays,
  sanitizeRelays,
  getReadRelays,
  getMostRecentReplacableEvent,
  findAllRelays,
  KIND_RELAY_METADATA_EVENT,
  KIND_KNOWLEDGE_NODE,
  KIND_CONTACTLIST,
  KIND_WORKSPACES,
  KIND_RELATION_TYPES,
  KIND_VIEWS,
  KIND_SETTINGS,
} from "citadel-commons";
import { List, Map, OrderedMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { DataContextProvider } from "./DataContext";
import { findContacts } from "./contacts";
import { useApis } from "./Apis";
import {
  findNodes,
  findRelationTypes,
  findRelations,
  findViews,
  findWorkspaces,
} from "./knowledgeEvents";
import { DEFAULT_SETTINGS, findSettings } from "./settings";
import { newDB } from "./knowledge";
import { PlanningContextProvider } from "./planner";
import { RootViewContextProvider } from "./ViewContext";
import { joinID } from "./connections";
import {
  addWorkspacesToFilter,
  createBaseFilter,
  filtersToFilterArray,
} from "./dataQuery";
import { useWorkspaceFromURL } from "./KnowledgeDataContext";
import { useDefaultRelays } from "./NostrAuthContext";
import { DEFAULT_COLOR } from "./components/RelationTypes";

type DataProps = {
  user: KeyPair;
  children: React.ReactNode;
};

type ProcessedEvents = {
  settings: Settings;
  knowledgeDB: KnowledgeData;
  contacts: Contacts;
  relays: Relays;

  views: Views;
  workspaces: List<ID>;
  activeWorkspace: LongID;
  relationTypes: RelationTypes;
};

export const DEFAULT_WORKSPACE = "my-first-workspace" as LongID;

function newProcessedEvents(): ProcessedEvents {
  return {
    settings: DEFAULT_SETTINGS,
    knowledgeDB: newDB(),
    contacts: Map<PublicKey, Contact>(),
    relays: [],
    views: Map<string, View>(),
    activeWorkspace: DEFAULT_WORKSPACE,
    workspaces: List<ID>(),
    relationTypes: OrderedMap<ID, RelationType>().set("" as ID, {
      color: DEFAULT_COLOR,
      label: "Default",
    }),
  };
}

export const KIND_SEARCH = [KIND_KNOWLEDGE_NODE];

const KINDS_CONTACTS_META = [
  KIND_WORKSPACES,
  KIND_RELATION_TYPES,
  KIND_RELAY_METADATA_EVENT,
];

const KINDS_META = [
  KIND_SETTINGS,
  KIND_CONTACTLIST,
  KIND_WORKSPACES,
  KIND_RELATION_TYPES,
  KIND_VIEWS,
];

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const settings = findSettings(authorEvents);
  const contacts = findContacts(authorEvents);
  const nodes = findNodes(authorEvents);
  const relations = findRelations(authorEvents);
  const workspaces = findWorkspaces(authorEvents);
  const views = findViews(authorEvents);
  const relationTypes = findRelationTypes(authorEvents);
  const knowledgeDB = {
    nodes,
    relations,
  };
  const relays = findRelays(authorEvents);
  return {
    settings,
    contacts,
    knowledgeDB,
    relays,
    views,
    workspaces: workspaces ? workspaces.workspaces : List<ID>(),
    activeWorkspace: workspaces
      ? workspaces.activeWorkspace
      : ("my-first-workspace" as LongID),
    relationTypes,
  };
}

export function useEventProcessor(
  events: List<UnsignedEvent>
): Map<PublicKey, ProcessedEvents> {
  const groupedByAuthor = events.groupBy((e) => e.pubkey as PublicKey);
  const sorted = groupedByAuthor.map((authorEvents) =>
    sortEventsDescending(List(authorEvents.valueSeq()))
  );
  return Map<PublicKey, ProcessedEvents>(
    sorted.toArray().map(([author, authorEvents]) => {
      return [author, processEventsByAuthor(authorEvents)];
    })
  );
}

function createDefaultEvents(user: KeyPair): List<UnsignedEvent> {
  const serialized = {
    w: [joinID(user.publicKey, "my-first-workspace")],
    a: joinID(user.publicKey, "my-first-workspace"),
  };
  const createWorkspaceNodeEvent = {
    kind: KIND_KNOWLEDGE_NODE,
    pubkey: user.publicKey,
    created_at: 0,
    tags: [["d", "my-first-workspace"]],
    content: "My first Workspace",
  };

  const writeWorkspacesEvent = {
    kind: KIND_WORKSPACES,
    pubkey: user.publicKey,
    created_at: 0,
    tags: [],
    content: JSON.stringify(serialized),
  };
  return List<UnsignedEvent>([createWorkspaceNodeEvent, writeWorkspacesEvent]);
}

export function useRelaysInfo(
  relays: Array<Relay>,
  eose: boolean
): Map<string, RelayInformation | undefined> {
  const { nip11 } = useApis();
  const [infos, setInfos] = useState<Map<string, RelayInformation | undefined>>(
    Map<string, RelayInformation | undefined>()
  );
  useEffect(() => {
    if (!eose) {
      return;
    }

    (async () => {
      const fetchedInfos = await Promise.all(
        relays.map(
          async (relay): Promise<[string, RelayInformation | undefined]> => {
            try {
              const info = await nip11.fetchRelayInformation(relay.url);
              return [relay.url, info];
            } catch {
              return [relay.url, undefined];
            }
          }
        )
      );
      setInfos(Map(fetchedInfos));
    })();
  }, [JSON.stringify(relays.map((r) => r.url)), eose]);
  return infos;
}

function mergePublishResultsOfEvents(
  existing: PublishResultsEventMap,
  newResults: PublishResultsEventMap
): PublishResultsEventMap {
  return newResults.reduce((rdx, results, eventID) => {
    const existingResults = rdx.get(eventID);
    if (!existingResults) {
      return rdx.set(eventID, results);
    }
    return rdx.set(eventID, {
      ...existingResults,
      results: existingResults.results.merge(results.results),
    });
  }, existing);
}

function Data({ user, children }: DataProps): JSX.Element {
  const defaultRelays = useDefaultRelays();
  const myPublicKey = user.publicKey;
  const [newEventsAndPublishResults, setNewEventsAndPublishResults] = useState<{
    events: List<UnsignedEvent>;
    results: PublishResultsEventMap;
  }>({ events: List(), results: Map() });
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const { relayPool } = useApis();
  const { events: relaysEvents, eose: relaysEose } = useEventQuery(
    relayPool,
    [createRelaysQuery([myPublicKey])],
    { enabled: true, readFromRelays: defaultRelays }
  );

  const newestEvent = getMostRecentReplacableEvent(relaysEvents);
  const myRelays = newestEvent ? findAllRelays(newestEvent) : defaultRelays;

  const mergedRelays = mergeRelays(
    sanitizeRelays(defaultRelays),
    sanitizeRelays(myRelays)
  );
  const readFromRelays = getReadRelays(mergedRelays);
  const relaysInfo = useRelaysInfo(mergedRelays, relaysEose);
  const { events: mE, eose: metaEventsEose } = useEventQuery(
    relayPool,
    [
      {
        authors: [myPublicKey],
        kinds: KINDS_META,
      },
    ],
    { readFromRelays }
  );
  const metaEvents = createDefaultEvents(user).merge(
    mE.valueSeq().toList().merge(newEventsAndPublishResults.events)
  );

  const processedMetaEvents = useEventProcessor(metaEvents).get(
    myPublicKey,
    newProcessedEvents()
  );
  const contacts = processedMetaEvents.contacts.filter(
    (_, k) => k !== myPublicKey
  );

  const { events: contactMetaEvents, eose: contactsMetaEventsEose } =
    useEventQuery(
      relayPool,
      [{ authors: contacts.keySeq().toArray(), kinds: KINDS_CONTACTS_META }],
      { readFromRelays, enabled: metaEventsEose }
    );

  const processedContactMetaEvents = useEventProcessor(
    contactMetaEvents.valueSeq().toList()
  );

  const contactsRelays = processedContactMetaEvents.reduce((rdx, p, key) => {
    return rdx.set(key, p.relays);
  }, Map<PublicKey, Relays>());

  const activeWorkspace =
    useWorkspaceFromURL() || processedMetaEvents.activeWorkspace;

  const workspaceFilters = processedContactMetaEvents.reduce((rdx, p) => {
    return addWorkspacesToFilter(rdx, p.workspaces as List<LongID>);
  }, addWorkspacesToFilter(createBaseFilter(contacts, myPublicKey), processedMetaEvents.workspaces as List<LongID>));

  const { events: workspaceEvents } = useEventQuery(
    relayPool,
    filtersToFilterArray(workspaceFilters),
    {
      readFromRelays,
      enabled: metaEventsEose && contactsMetaEventsEose,
    }
  );

  const rDataEventsProcessed = useEventProcessor(
    metaEvents
      .merge(contactMetaEvents.valueSeq().toList())
      .merge(workspaceEvents.valueSeq().toList())
  );
  const knowledgeDBs = rDataEventsProcessed.map((data) => data.knowledgeDB);

  const contactsRelationTypes = rDataEventsProcessed
    .map((data) => data.relationTypes)
    .filter((_, k) => k !== myPublicKey);
  const contactsWorkspaces = rDataEventsProcessed
    .map((data) => data.workspaces)
    .filter((_, k) => k !== myPublicKey);

  const addNewEvents = (events: List<UnsignedEvent>): void => {
    setLoadingResults(true);
    setNewEventsAndPublishResults((prev) => {
      return {
        events: prev.events.merge(events),
        results: prev.results,
      };
    });
  };

  const updatePublishResults = (results: PublishResultsEventMap): void => {
    setNewEventsAndPublishResults((prev) => {
      return {
        events: prev.events,
        results: mergePublishResultsOfEvents(prev.results, results),
      };
    });
    setLoadingResults(false);
  };

  return (
    <DataContextProvider
      contacts={contacts}
      user={user}
      settings={processedMetaEvents.settings}
      relays={sanitizeRelays(myRelays)}
      contactsRelays={contactsRelays}
      knowledgeDBs={knowledgeDBs}
      relaysInfos={relaysInfo}
      publishResults={newEventsAndPublishResults.results}
      unpublishedEvents={newEventsAndPublishResults.events}
      loadingResults={loadingResults}
      views={processedMetaEvents.views}
      workspaces={processedMetaEvents.workspaces}
      activeWorkspace={activeWorkspace}
      relationTypes={processedMetaEvents.relationTypes}
      contactsRelationTypes={contactsRelationTypes}
      contactsWorkspaces={contactsWorkspaces}
    >
      <PlanningContextProvider
        addNewEvents={addNewEvents}
        updatePublishResults={updatePublishResults}
      >
        <RootViewContextProvider root={activeWorkspace}>
          {children}
        </RootViewContextProvider>
      </PlanningContextProvider>
    </DataContextProvider>
  );
}
export default Data;
