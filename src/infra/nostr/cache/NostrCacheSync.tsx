import { useEffect, useMemo } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useApis } from "../../../Apis";
import { useBackend } from "../../../BackendContext";
import { useData } from "../../../DataContext";
import { useDocumentStore } from "../../../DocumentStore";
import { KIND_KNOWLEDGE_DOCUMENT } from "../../../nostr";
import { normalizedRelayUrls } from "../../../pullSources";
import {
  applyStoredDelete,
  applyStoredDocument,
  startPermanentDocumentSync,
  toStoredDeleteRecord,
  toStoredDocumentRecord,
} from "../../../permanentSync";
import { storedDocumentToEvent } from "../../../documentMaterialization";
import { useCacheDB } from "./CacheDBContext";
import {
  CachedEvent,
  getCachedEvents,
  getStoredDeletes,
  getStoredDocuments,
  putCachedEvents,
  StashmapDB,
  StoredDocumentRecord,
  StoredDeleteRecord,
  DocumentStoreChange,
  subscribeDocumentStore,
} from "./indexedDB";

function toCachedEvent(event: Event | UnsignedEvent): CachedEvent | undefined {
  if ("id" in event && typeof event.id === "string") {
    return event as CachedEvent;
  }
  const document = toStoredDocumentRecord(event);
  if (document) {
    return { ...event, id: document.eventId };
  }
  const deletion = toStoredDeleteRecord(event);
  if (deletion) {
    return { ...event, id: deletion.eventId };
  }
  return undefined;
}

async function loadInitialEvents(
  db: StashmapDB
): Promise<ReadonlyArray<Event | UnsignedEvent>> {
  const [documents, deletes] = await Promise.all([
    typeof getStoredDocuments === "function"
      ? getStoredDocuments(db)
      : Promise.resolve([] as StoredDocumentRecord[]),
    typeof getStoredDeletes === "function"
      ? getStoredDeletes(db)
      : Promise.resolve([] as StoredDeleteRecord[]),
  ]);
  if ((documents || []).length === 0 && (deletes || []).length === 0) {
    if (typeof getCachedEvents !== "function") return [];
    return (await getCachedEvents(db)) || [];
  }
  return [
    ...(documents || []).map((doc) => storedDocumentToEvent(doc)),
    ...((deletes || []).map((deletion) => ({
      id: deletion.eventId,
      kind: 5,
      pubkey: deletion.author,
      created_at: deletion.createdAt,
      content: "",
      tags: [
        ["a", deletion.replaceableKey],
        ["k", "30023"],
        ["ms", `${deletion.deletedAt}`],
      ],
      sig: "",
    })) as Event[]),
  ];
}

function changeToEvent(
  change: DocumentStoreChange
): Event | UnsignedEvent | undefined {
  if (change.type === "document-put") {
    return storedDocumentToEvent(change.document);
  }
  if (change.type === "delete-put") {
    return {
      id: change.deletion.eventId,
      kind: 5,
      pubkey: change.deletion.author,
      created_at: change.deletion.createdAt,
      content: "",
      tags: [
        ["a", change.deletion.replaceableKey],
        ["k", "30023"],
        ["ms", `${change.deletion.deletedAt}`],
      ],
      sig: "",
    } as Event;
  }
  return undefined;
}

export function NostrCacheSync(): null {
  const db = useCacheDB();
  const addEvents = useDocumentStore()?.addEvents;
  const { relayPool } = useApis();
  const backend = useBackend();
  const { user, panes, publishEventsStatus } = useData();
  const storageRelayUrls = useMemo(
    () => normalizedRelayUrls(backend.workspaceConfig.storageRelays),
    [backend.workspaceConfig.storageRelays]
  );
  const foreignSources = useMemo(
    () =>
      panes
        .flatMap((pane) => {
          const coordinate = pane.routeCoordinate;
          if (
            !coordinate ||
            coordinate.eventKind !== KIND_KNOWLEDGE_DOCUMENT ||
            coordinate.pubkey === user?.publicKey ||
            !pane.storageKey
          ) {
            return [];
          }
          const relays = normalizedRelayUrls(coordinate.relays);
          return relays.length === 0
            ? []
            : [{ coordinate, storageKey: pane.storageKey, relays }];
        })
        .filter(
          (source, index, sources) =>
            sources.findIndex(
              (candidate) =>
                candidate.coordinate.pubkey === source.coordinate.pubkey &&
                candidate.coordinate.dTag === source.coordinate.dTag &&
                candidate.storageKey === source.storageKey &&
                candidate.relays.join("|") === source.relays.join("|")
            ) === index
        ),
    [panes, user?.publicKey]
  );
  const foreignSourcesSignature = JSON.stringify(foreignSources);

  useEffect(() => {
    if (!db || !addEvents) return () => {};
    const controller = new AbortController();
    loadInitialEvents(db).then((events) => {
      if (controller.signal.aborted || events.length === 0) return;
      addEvents(
        ImmutableMap<string, Event | UnsignedEvent>(
          events.map((event, index) => {
            const id =
              "id" in event && typeof event.id === "string"
                ? event.id
                : `initial-${index}`;
            return [id, event] as [string, Event | UnsignedEvent];
          })
        )
      );
    });
    const unsubscribe =
      typeof subscribeDocumentStore === "function"
        ? subscribeDocumentStore(db, (change) => {
            if (controller.signal.aborted) return;
            const event = changeToEvent(change);
            if (!event) return;
            const id =
              "id" in event && event.id ? event.id : `change-${Date.now()}`;
            addEvents(
              ImmutableMap<string, Event | UnsignedEvent>([[id, event]])
            );
          })
        : () => {};
    return () => {
      controller.abort();
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [db, addEvents]);

  useEffect(() => {
    const closers = [
      ...(user
        ? [
            startPermanentDocumentSync({
              db: db || null,
              relayPool,
              relayUrls: storageRelayUrls,
              authors: [user.publicKey],
              user,
              capabilityKeys: [],
              dTags: [],
              addLiveEvents: addEvents,
            }),
          ]
        : []),
      ...foreignSources.map((source) =>
        startPermanentDocumentSync({
          db: null,
          relayPool,
          relayUrls: source.relays,
          authors: [source.coordinate.pubkey],
          user,
          capabilityKeys: [source.storageKey],
          dTags: [source.coordinate.dTag],
          addLiveEvents: addEvents,
        })
      ),
    ];
    return () => closers.forEach((close) => close());
  }, [
    addEvents,
    db,
    relayPool,
    storageRelayUrls,
    user,
    foreignSourcesSignature,
  ]);

  const persistEvents = useMemo(() => {
    if (!db) return undefined;
    return (events: ReadonlyArray<Event | UnsignedEvent>) => {
      events.forEach((event) => {
        const document = toStoredDocumentRecord(event);
        if (document) {
          applyStoredDocument(db, document).catch(() => undefined);
        }
        const deletion = toStoredDeleteRecord(event);
        if (deletion) {
          applyStoredDelete(db, deletion).catch(() => undefined);
        }
      });
      if (typeof putCachedEvents === "function") {
        putCachedEvents(
          db,
          events
            .map(toCachedEvent)
            .filter((event): event is CachedEvent => event !== undefined)
        ).catch(() => undefined);
      }
    };
  }, [db]);

  useEffect(() => {
    if (!persistEvents || publishEventsStatus.unsignedEvents.size === 0) {
      return;
    }
    persistEvents(publishEventsStatus.unsignedEvents.toArray());
  }, [persistEvents, publishEventsStatus.unsignedEvents]);

  return null;
}
