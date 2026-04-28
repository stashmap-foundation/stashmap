import { useEffect, useMemo } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useApis } from "../../../Apis";
import { useData } from "../../../DataContext";
import { useDocumentStore } from "../../../DocumentStore";
import { useDefaultRelays } from "../../../NostrAuthContext";
import { useUserRelayContext } from "../../../UserRelayContext";
import {
  flattenRelays,
  getReadRelays,
  sanitizeRelays,
} from "../../../relayUtils";
import {
  applyStoredDelete,
  applyStoredDocument,
  buildPermanentSyncAuthors,
  startPermanentDocumentSync,
  toStoredDeleteRecord,
  toStoredDocumentRecord,
} from "../../../permanentSync";
import { splitID } from "../../../core/connections";
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
  const { user, contacts, contactsRelays, panes } = useData();
  const { userRelays } = useUserRelayContext();
  const defaultRelays = useDefaultRelays();

  const extraAuthors = useMemo(
    () => [
      ...new globalThis.Set(
        panes.flatMap((pane) =>
          pane.rootNodeId
            ? [pane.author, splitID(pane.rootNodeId)[0] || pane.author]
            : [pane.author]
        )
      ),
    ],
    [panes]
  );

  const authors = useMemo(
    () =>
      [
        ...new globalThis.Set([
          ...buildPermanentSyncAuthors(user.publicKey, contacts),
          ...extraAuthors,
        ]),
      ].sort(),
    [user.publicKey, contacts, extraAuthors]
  );

  const relayUrls = useMemo(
    () =>
      [
        ...new Set(
          getReadRelays([
            ...defaultRelays,
            ...userRelays,
            ...flattenRelays(contactsRelays),
          ])
            .flatMap((relay) => sanitizeRelays([relay]).map((r) => r.url))
            .map((url) => url.trim().replace(/\/$/, ""))
        ),
      ].sort(),
    [defaultRelays, userRelays, contactsRelays]
  );

  // Load persisted state and subscribe to cross-tab changes
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

  // Subscribe to relays for live documents/deletes
  useEffect(() => {
    if (db === undefined || relayUrls.length === 0 || authors.length === 0) {
      return () => {};
    }
    return startPermanentDocumentSync({
      db: db || null,
      relayPool,
      relayUrls,
      authors,
      addLiveEvents: addEvents,
    });
  }, [addEvents, authors, db, relayPool, relayUrls]);

  // Persist locally-added events to IndexedDB
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
            .filter((e): e is CachedEvent => e !== undefined)
        ).catch(() => undefined);
      }
    };
  }, [db]);

  // Persist unpublishedEvents (from planner) to IndexedDB so they survive reload
  const { publishEventsStatus } = useData();
  useEffect(() => {
    if (!persistEvents || publishEventsStatus.unsignedEvents.size === 0) {
      return;
    }
    persistEvents(publishEventsStatus.unsignedEvents.toArray());
  }, [persistEvents, publishEventsStatus.unsignedEvents]);

  return null;
}
