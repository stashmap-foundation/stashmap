import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { List, Map, Set, OrderedSet } from "immutable";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_CONTACTLIST,
  KIND_SETTINGS,
  KIND_RELAY_METADATA_EVENT,
} from "./nostr";
import { DataContextProvider, MergeKnowledgeDB } from "./DataContext";
import { useApis } from "./Apis";
import { PlanningContextProvider, replaceUnauthenticatedUser } from "./planner";
import { useUserRelayContext } from "./UserRelayContext";
import { flattenRelays, usePreloadRelays } from "./relays";
import { useDefaultRelays } from "./NostrAuthContext";
import { useEventQuery } from "./commons/useNostrQuery";
import { openDB, StashmapDB, getOutboxEvents } from "./indexedDB";
import {
  pathToStack,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";
import { splitID } from "./connections";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { generatePaneId } from "./SplitPanesContext";
import {
  jsonToPanes,
  jsonToViews,
  paneToJSON,
  Serializable,
  viewDataToJSON,
} from "./serializer";
import { NavigationStateProvider } from "./NavigationStateContext";
import {
  mergeEvents,
  newProcessedEvents,
  processEvents,
} from "./eventProcessing";
import { DocumentStoreProvider, useDocumentStore } from "./DocumentStore";
import { usePermanentDocumentSync } from "./usePermanentDocumentSync";
import { createEmptySemanticIndex } from "./semanticIndex";

export const defaultPane = (author: PublicKey, rootItemID?: ID): Pane => ({
  id: generatePaneId(),
  stack: rootItemID ? [rootItemID] : [],
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

function viewsStorageKey(publicKey: PublicKey): string {
  return `stashmap-views-${publicKey}`;
}

function loadViewsFromStorage(publicKey: PublicKey): Views | undefined {
  try {
    const raw = localStorage.getItem(viewsStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }

    return jsonToViews(JSON.parse(raw) as Serializable);
  } catch {
    return undefined;
  }
}

function saveViewsToStorage(publicKey: PublicKey, views: Views): void {
  try {
    localStorage.setItem(
      viewsStorageKey(publicKey),
      JSON.stringify(viewDataToJSON(views, []))
    );
  } catch {
    // ignore storage errors
  }
}

function getInitialPanes(publicKey: PublicKey): Pane[] {
  const nodeID = parseNodeRouteUrl(window.location.pathname);
  if (nodeID) {
    const nodeAuthor = splitID(nodeID)[0] || publicKey;
    return [
      {
        id: generatePaneId(),
        stack: [],
        author: nodeAuthor,
        rootNodeId: nodeID,
      },
    ];
  }
  const urlStack = pathToStack(window.location.pathname);
  if (urlStack.length > 0) {
    const urlAuthor =
      parseAuthorFromSearch(window.location.search) || publicKey;
    return [{ id: generatePaneId(), stack: urlStack, author: urlAuthor }];
  }
  const historyState = window.history.state as {
    panes?: Pane[];
  } | null;
  if (historyState?.panes && historyState.panes.length > 0) {
    return historyState.panes;
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

function PermanentDocumentSyncBridge({
  db,
  myself,
  contacts,
  projectMembers,
  extraAuthors,
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  db: StashmapDB | null | undefined;
  myself: PublicKey;
  contacts: Contacts;
  projectMembers: Members;
  extraAuthors: PublicKey[];
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: Map<PublicKey, Relays>;
}): null {
  const addLiveEvents = useDocumentStore()?.addEvents;

  usePermanentDocumentSync({
    enabled: db !== undefined,
    db: db || null,
    myself,
    contacts,
    projectMembers,
    extraAuthors,
    addLiveEvents,
    defaultRelays,
    userRelays,
    contactsRelays,
  });

  return null;
}

export const KIND_SEARCH = [KIND_KNOWLEDGE_DOCUMENT];

export const KINDS_META = [KIND_SETTINGS, KIND_CONTACTLIST];

function useRelaysInfo(
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
  baseSelection: OrderedSet<string>(),
  shiftSelection: OrderedSet<string>(),
  anchor: "",
  editingViews: Set<string>(),
  editorOpenViews: Set<string>(),
  draftTexts: Map<string, string>(),
};

function Data({ user, children }: DataProps): JSX.Element {
  const myPublicKey = user.publicKey;
  const [panes, setPanes] = useState<Pane[]>(() =>
    getInitialPanes(myPublicKey)
  );
  const [views, setViews] = useState<Views>(
    () => loadViewsFromStorage(myPublicKey) || Map<string, View>()
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

  const [db, setDb] = useState<StashmapDB | null | undefined>(undefined);

  useEffect(() => {
    openDB().then(async (database) => {
      setDb(database || null);
      if (!database) return;
      const outbox = await getOutboxEvents(database);
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

  useEffect(() => {
    return () => {
      if (db && typeof db.close === "function") {
        db.close();
      }
    };
  }, [db]);

  const initialPublicKeyRef = useRef(myPublicKey);
  useEffect(() => {
    if (myPublicKey === initialPublicKeyRef.current) {
      return;
    }
    const savedPanes = loadPanesFromStorage(myPublicKey);
    const savedViews = loadViewsFromStorage(myPublicKey);
    if (savedPanes) {
      setPanes(savedPanes);
    } else {
      setPanes((current) =>
        current.map((p) => ({
          ...p,
          author: replaceUnauthenticatedUser(p.author, myPublicKey),
        }))
      );
    }
    if (savedViews) {
      setViews(savedViews);
    }
  }, [myPublicKey]);

  useEffect(() => {
    savePanesToStorage(myPublicKey, panes);
  }, [panes, myPublicKey]);

  useEffect(() => {
    saveViewsToStorage(myPublicKey, views);
  }, [views, myPublicKey]);

  const { events: mE, eose: metaEventsEose } = useEventQuery(
    relayPool,
    [
      { authors: [myPublicKey], kinds: [KIND_SETTINGS], limit: 1 },
      { authors: [myPublicKey], kinds: [KIND_CONTACTLIST], limit: 1 },
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
      semanticIndex={createEmptySemanticIndex()}
      relaysInfos={searchRelaysInfo}
      publishEventsStatus={newEventsAndPublishResults}
      views={views}
      panes={panes}
      projectMembers={projectMembers}
    >
      <DocumentStoreProvider
        db={db || null}
        unpublishedEvents={newEventsAndPublishResults.unsignedEvents}
      >
        <PermanentDocumentSyncBridge
          db={db}
          myself={myPublicKey}
          contacts={contacts}
          projectMembers={projectMembers}
          extraAuthors={[
            ...new globalThis.Set(
              panes.flatMap((pane) =>
                pane.rootNodeId
                  ? [pane.author, splitID(pane.rootNodeId)[0] || pane.author]
                  : [pane.author]
              )
            ),
          ]}
          defaultRelays={defaultRelays}
          userRelays={userRelays}
          contactsRelays={contactsRelays}
        />
        <MergeKnowledgeDB>
          <PlanningContextProvider
            setPublishEvents={setNewEventsAndPublishResults}
            setPanes={setPanes}
            setViews={setViews}
            db={db || null}
            getRelays={() => ({
              defaultRelays,
              userRelays,
              contactsRelays: flattenRelays(contactsRelays),
            })}
          >
            <NavigationStateProvider>{children}</NavigationStateProvider>
          </PlanningContextProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
export default Data;
