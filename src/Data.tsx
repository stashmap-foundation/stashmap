import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { List, Map, Set, OrderedSet } from "immutable";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_CONTACTLIST,
  KIND_SETTINGS,
  KIND_RELAY_METADATA_EVENT,
} from "./nostr";
import { DataContextProvider, MergeKnowledgeDB } from "./DataContext";
import { useApis } from "./Apis";
import { replaceUnauthenticatedUser } from "./app/actions";
import { PlanningContextProvider } from "./features/app-shell/PlannerContext";
import { useUserRelayContext } from "./UserRelayContext";
import { flattenRelays, usePreloadRelays } from "./relays";
import { useDefaultRelays } from "./NostrAuthContext";
import { useEventQuery } from "./commons/useNostrQuery";
import { openDB, StashmapDB, getOutboxEvents } from "./indexedDB";
import { splitID } from "./connections";
import {
  getInitialPanes,
  loadPanesFromStorage,
  loadViewsFromStorage,
  savePanesToStorage,
  saveViewsToStorage,
} from "./infra/storage";
import { NavigationStateProvider } from "./features/navigation/NavigationStateContext";
import {
  mergeEvents,
  newProcessedEvents,
  processEvents,
} from "./eventProcessing";
import { DocumentStoreProvider } from "./DocumentStore";
import { createEmptySemanticIndex } from "./semanticIndex";
import { PermanentDocumentSyncBridge } from "./features/app-shell/PermanentDocumentSyncBridge";
import { useRelaysInfo } from "./features/app-shell/useRelaysInfo";

export { defaultPane } from "./session/panes";

type DataProps = {
  user: User;
  children: React.ReactNode;
};

export const KIND_SEARCH = [KIND_KNOWLEDGE_DOCUMENT];

export const KINDS_META = [KIND_SETTINGS, KIND_CONTACTLIST];

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
    >
      <DocumentStoreProvider
        db={db || null}
        unpublishedEvents={newEventsAndPublishResults.unsignedEvents}
      >
        <PermanentDocumentSyncBridge
          db={db}
          myself={myPublicKey}
          contacts={contacts}
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
