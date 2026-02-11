import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { List, Map, Set, OrderedSet } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import {
  KIND_KNOWLEDGE_NODE,
  KIND_CONTACTLIST,
  KIND_VIEWS,
  KIND_SETTINGS,
  KIND_RELAY_METADATA_EVENT,
} from "./nostr";
import { DataContextProvider, MergeKnowledgeDB } from "./DataContext";
import { EventCacheProvider } from "./EventCache";
import { findContacts, findMembers } from "./contacts";
import { useApis } from "./Apis";
import { findNodes, findRelations, findViews } from "./knowledgeEvents";
import { newDB } from "./knowledge";
import { PlanningContextProvider, replaceUnauthenticatedUser } from "./planner";
import { useUserRelayContext } from "./UserRelayContext";
import { flattenRelays, usePreloadRelays, findRelays } from "./relays";
import { useDefaultRelays } from "./NostrAuthContext";
import { useEventQuery } from "./commons/useNostrQuery";
import {
  openDB,
  StashmapDB,
  getCachedEvents,
  getOutboxEvents,
  putCachedEvents,
} from "./indexedDB";
import {
  pathToStack,
  parseRelationUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { generatePaneId } from "./SplitPanesContext";
import { jsonToPanes, paneToJSON, Serializable } from "./serializer";
import { NavigationStateProvider } from "./NavigationStateContext";

export const defaultPane = (
  author: PublicKey,
  rootNodeID?: LongID | ID
): Pane => ({
  id: generatePaneId(),
  stack: rootNodeID ? [rootNodeID] : [],
  author,
});

function panesStorageKey(publicKey: PublicKey): string {
  return `stashmap-panes-${publicKey}`;
}

function loadPanesFromStorage(publicKey: PublicKey): Pane[] | undefined {
  try {
    const raw = localStorage.getItem(panesStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }
    const panes = jsonToPanes({ panes: JSON.parse(raw) as Serializable });

    return panes.length > 0 ? panes : undefined;
  } catch {
    return undefined;
  }
}

function savePanesToStorage(publicKey: PublicKey, panes: Pane[]): void {
  if (publicKey === UNAUTHENTICATED_USER_PK) {
    return;
  }
  try {
    const serialized = panes.map((p) => paneToJSON(p));
    localStorage.setItem(
      panesStorageKey(publicKey),
      JSON.stringify(serialized)
    );
  } catch {
    // ignore storage errors
  }
}

function getInitialPanes(publicKey: PublicKey): Pane[] {
  const historyState = window.history.state as {
    panes?: Pane[];
  } | null;
  if (historyState?.panes && historyState.panes.length > 0) {
    return historyState.panes;
  }
  const relationID = parseRelationUrl(window.location.pathname);
  if (relationID) {
    return [
      {
        id: generatePaneId(),
        stack: [],
        author: publicKey,
        rootRelation: relationID,
      },
    ];
  }
  const urlStack = pathToStack(window.location.pathname);
  if (urlStack.length > 0) {
    const urlAuthor =
      parseAuthorFromSearch(window.location.search) || publicKey;
    return [{ id: generatePaneId(), stack: urlStack, author: urlAuthor }];
  }
  const stored = loadPanesFromStorage(publicKey);
  if (stored) {
    return stored;
  }
  return [defaultPane(publicKey)];
}

type DataProps = {
  user: User;
  children: React.ReactNode;
};

type ProcessedEvents = {
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

export const KIND_SEARCH = [KIND_KNOWLEDGE_NODE];

export const KINDS_META = [KIND_SETTINGS, KIND_CONTACTLIST, KIND_VIEWS];

function mergeEvents(
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
  const nodes = findNodes(authorEvents);
  const relations = findRelations(authorEvents);
  const views = findViews(authorEvents);
  const projectMembers = findMembers(authorEvents);
  const knowledgeDB = {
    nodes,
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
  events: List<UnsignedEvent>
): Map<PublicKey, ProcessedEvents> {
  const groupedByAuthor = events.groupBy((e) => e.pubkey as PublicKey);
  return Map<PublicKey, ProcessedEvents>(
    groupedByAuthor.toArray().map(([author, authorEvents]) => {
      return [author, processEventsByAuthor(List(authorEvents.valueSeq()))];
    })
  );
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

const DEFAULT_TEMPORARY_VIEW: TemporaryViewState = {
  rowFocusIntents: Map<number, RowFocusIntent>(),
  selection: OrderedSet<string>(),
  multiselectBtns: Set<string>(),
  editingViews: Set<string>(),
  editorOpenViews: Set<string>(),
  draftTexts: Map<string, string>(),
};

function Data({ user, children }: DataProps): JSX.Element {
  const myPublicKey = user.publicKey;
  const [panes, setPanes] = useState<Pane[]>(() =>
    getInitialPanes(myPublicKey)
  );
  const [newEventsAndPublishResults, setNewEventsAndPublishResults] =
    useState<EventState>({
      unsignedEvents: List(),
      results: Map(),
      isLoading: false,
      preLoginEvents: List(),
      temporaryView: DEFAULT_TEMPORARY_VIEW,
      temporaryEvents: List(),
    });
  const { isRelaysLoaded, userRelays } = useUserRelayContext();
  const defaultRelays = useDefaultRelays();
  const { relayPool } = useApis();

  const [db, setDb] = useState<StashmapDB | null>(null);
  const [initialCachedEvents, setInitialCachedEvents] = useState<
    Map<string, Event | UnsignedEvent>
  >(Map());

  useEffect(() => {
    openDB().then(async (database) => {
      if (!database) return;
      setDb(database);
      const [cached, outbox] = await Promise.all([
        getCachedEvents(database),
        getOutboxEvents(database),
      ]);
      const eventsMap = (cached as unknown as ReadonlyArray<Event>).reduce(
        (rdx: Map<string, Event | UnsignedEvent>, event: Event) =>
          event.id ? rdx.set(event.id, event) : rdx,
        Map<string, Event | UnsignedEvent>()
      );
      setInitialCachedEvents(eventsMap);
      if (outbox.length > 0) {
        setNewEventsAndPublishResults((prev) => ({
          ...prev,
          unsignedEvents: prev.unsignedEvents.concat(
            List(outbox.map((entry) => entry.event))
          ),
        }));
      }
    });
  }, []);

  const onEventsAdded = useCallback(
    (events: Map<string, Event | UnsignedEvent>) => {
      if (!db) return;
      const asRecords = events
        .valueSeq()
        .toArray()
        .map((e) => e as unknown as Record<string, unknown>);
      putCachedEvents(db, asRecords).catch(() => {});
    },
    [db]
  );

  const initialPublicKeyRef = useRef(myPublicKey);
  useEffect(() => {
    if (myPublicKey === initialPublicKeyRef.current) {
      return;
    }
    const savedPanes = loadPanesFromStorage(myPublicKey);
    if (savedPanes) {
      setPanes(savedPanes);
      return;
    }
    setPanes((current) =>
      current.map((p) => ({
        ...p,
        author: replaceUnauthenticatedUser(p.author, myPublicKey),
      }))
    );
  }, [myPublicKey]);

  useEffect(() => {
    savePanesToStorage(myPublicKey, panes);
  }, [panes, myPublicKey]);

  const { events: mE, eose: metaEventsEose } = useEventQuery(
    relayPool,
    [
      { authors: [myPublicKey], kinds: [KIND_SETTINGS], limit: 1 },
      { authors: [myPublicKey], kinds: [KIND_CONTACTLIST], limit: 1 },
      { authors: [myPublicKey], kinds: [KIND_VIEWS], limit: 1 },
    ],
    {
      readFromRelays: usePreloadRelays({
        user: true,
      }),
    }
  );
  const metaEvents = mE
    .valueSeq()
    .toList()
    .merge(newEventsAndPublishResults.unsignedEvents);

  const processedMetaEvents = mergeEvents(
    processEvents(metaEvents).get(myPublicKey, newProcessedEvents()),
    newEventsAndPublishResults.preLoginEvents
  );
  const contacts = processedMetaEvents.contacts.filter(
    (_, k) => k !== myPublicKey
  );

  const { events: contactRelayEvents } = useEventQuery(
    relayPool,
    [
      {
        authors: contacts.keySeq().toArray(),
        kinds: [KIND_RELAY_METADATA_EVENT],
      },
    ],
    {
      readFromRelays: usePreloadRelays({
        defaultRelays: true,
        user: true,
      }),
      enabled: metaEventsEose,
    }
  );

  const processedContactRelayEvents = processEvents(
    contactRelayEvents.valueSeq().toList()
  );

  const contactsRelays = processedContactRelayEvents.reduce((rdx, p, key) => {
    return rdx.set(key, p.relays);
  }, Map<PublicKey, Relays>());
  const searchRelaysInfo = useRelaysInfo(
    [
      ...usePreloadRelays({
        defaultRelays: false,
        user: true,
      }),
      ...flattenRelays(contactsRelays),
    ],
    isRelaysLoaded
  );

  const projectMembers = Map<PublicKey, Member>();

  return (
    <DataContextProvider
      contacts={contacts}
      user={user}
      contactsRelays={contactsRelays}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
      relaysInfos={searchRelaysInfo}
      publishEventsStatus={newEventsAndPublishResults}
      views={processedMetaEvents.views}
      panes={panes}
      projectMembers={projectMembers}
    >
      <EventCacheProvider
        unpublishedEvents={newEventsAndPublishResults.unsignedEvents}
        initialCachedEvents={initialCachedEvents}
        onEventsAdded={onEventsAdded}
      >
        <MergeKnowledgeDB>
          <PlanningContextProvider
            setPublishEvents={setNewEventsAndPublishResults}
            setPanes={setPanes}
            db={db}
            getRelays={() => ({
              defaultRelays,
              userRelays,
              contactsRelays: flattenRelays(contactsRelays),
            })}
          >
            <NavigationStateProvider>{children}</NavigationStateProvider>
          </PlanningContextProvider>
        </MergeKnowledgeDB>
      </EventCacheProvider>
    </DataContextProvider>
  );
}
export default Data;
