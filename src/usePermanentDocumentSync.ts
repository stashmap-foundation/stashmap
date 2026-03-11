import { Map } from "immutable";
import { useEffect, useMemo } from "react";
import { Event, UnsignedEvent } from "nostr-tools";
import { useApis } from "./Apis";
import type { StashmapDB } from "./indexedDB";
import { flattenRelays, getReadRelays, sanitizeRelays } from "./relayUtils";
import {
  buildPermanentSyncAuthors,
  startPermanentDocumentSync,
} from "./permanentSync";

export function usePermanentDocumentSync({
  db,
  myself,
  contacts,
  projectMembers,
  extraAuthors = [],
  addLiveEvents,
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  db: StashmapDB | null;
  myself: PublicKey;
  contacts: Contacts;
  projectMembers: Members;
  extraAuthors?: PublicKey[];
  addLiveEvents?: (events: Map<string, Event | UnsignedEvent>) => void;
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: Map<PublicKey, Relays>;
}): void {
  const { relayPool } = useApis();
  const authors = useMemo(
    () =>
      [
        ...new globalThis.Set([
          ...buildPermanentSyncAuthors(myself, contacts, projectMembers),
          ...extraAuthors,
        ]),
      ].sort(),
    [myself, contacts, projectMembers, extraAuthors]
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

  useEffect(() => {
    if (
      (!db && !addLiveEvents) ||
      relayUrls.length === 0 ||
      authors.length === 0
    ) {
      return () => {};
    }
    return startPermanentDocumentSync({
      db,
      relayPool,
      relayUrls,
      authors,
      addLiveEvents,
    });
  }, [addLiveEvents, authors, db, relayPool, relayUrls]);
}
