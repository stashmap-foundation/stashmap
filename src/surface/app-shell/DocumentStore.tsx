import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type { KnowledgeDBs, SemanticIndex } from "../../graph/types";
import type { StashmapDB } from "../../infra/indexedDB";
import { createEmptySemanticIndex } from "../../graph/semanticIndex";
import {
  eventsToStoredRecords,
  getStoredRecordEventID,
} from "../../infra/documentStoreRecords";
import {
  applyChangeToSnapshot,
  applyRecordsToSnapshot,
  createSnapshotFromStoredRecords,
  createEmptySnapshot,
  type DocumentSnapshot,
} from "./documentStoreState";
import {
  loadInitialDocumentStoreRecords,
  persistDocumentStoreEvents,
  subscribeToDocumentStore,
} from "../../infra/documentStoreRepository";

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

export function DocumentStoreProvider({
  children,
  db,
  unpublishedEvents = List<UnsignedEvent>(),
}: {
  children: React.ReactNode;
  db?: StashmapDB | null;
  unpublishedEvents?: List<UnsignedEvent>;
}): JSX.Element {
  const [snapshot, setSnapshot] =
    React.useState<DocumentSnapshot>(createEmptySnapshot);
  const persistedUnpublishedKeysRef = React.useRef<globalThis.Set<string>>(
    new globalThis.Set<string>()
  );

  React.useEffect(() => {
    if (!db) {
      return () => {};
    }
    const controller = new AbortController();
    loadInitialDocumentStoreRecords(db).then(({ documents, deletes }) => {
      if (controller.signal.aborted) {
        return;
      }
      setSnapshot(createSnapshotFromStoredRecords(documents, deletes));
    });
    const unsubscribe = subscribeToDocumentStore(db, (change) => {
      if (controller.signal.aborted) {
        return;
      }
      setSnapshot((current) => applyChangeToSnapshot(current, change));
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [db]);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { documents, deletes } = eventsToStoredRecords(eventList);

      if (documents.length === 0 && deletes.length === 0) {
        return;
      }

      if (!db) {
        setSnapshot((current) =>
          applyRecordsToSnapshot(current, documents, deletes)
        );
        return;
      }

      persistDocumentStoreEvents(db, eventList).catch(() => undefined);
    },
    [db]
  );

  React.useEffect(() => {
    if (!db || unpublishedEvents.size === 0) {
      return;
    }

    const nextEvents = unpublishedEvents
      .filter((event) => {
        const key = getStoredRecordEventID(event);
        if (!key || persistedUnpublishedKeysRef.current.has(key)) {
          return false;
        }
        persistedUnpublishedKeysRef.current.add(key);
        return true;
      })
      .toList();

    if (nextEvents.size === 0) {
      return;
    }

    addEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        nextEvents
          .map(
            (event, index) =>
              [`pending-${index}`, event] as [string, Event | UnsignedEvent]
          )
          .toArray()
      )
    );
  }, [addEvents, db, unpublishedEvents]);

  const activeSnapshot = React.useMemo(() => {
    const { documents, deletes } = eventsToStoredRecords(
      unpublishedEvents.toArray()
    );
    return applyRecordsToSnapshot(snapshot, documents, deletes);
  }, [snapshot, unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeSnapshot.knowledgeDBs,
      semanticIndex: activeSnapshot.semanticIndex,
      addEvents,
    }),
    [activeSnapshot, addEvents]
  );

  return (
    <DocumentStoreContext.Provider value={contextValue}>
      {children}
    </DocumentStoreContext.Provider>
  );
}

export function useDocumentStore(): DocumentStoreState | undefined {
  return React.useContext(DocumentStoreContext);
}

export function useDocumentKnowledgeDBs(): KnowledgeDBs {
  return React.useContext(DocumentStoreContext)?.knowledgeDBs || ImmutableMap();
}

export function useDocumentSemanticIndex(): SemanticIndex {
  return (
    React.useContext(DocumentStoreContext)?.semanticIndex ||
    createEmptySemanticIndex()
  );
}
