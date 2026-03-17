import { Map } from "immutable";
import { useEffect, useMemo } from "react";
import { Event, UnsignedEvent } from "nostr-tools";
import type { Contacts, PublicKey } from "../../graph/identity";
import type { Relays } from "../../infra/publishTypes";
import { useApis } from "./ApiContext";
import type { StashmapDB } from "../../infra/indexedDB";
import {
  flattenRelays,
  getReadRelays,
  sanitizeRelays,
} from "../../infra/relayUtils";
import {
  buildPermanentSyncAuthors,
  startPermanentDocumentSync,
} from "../../infra/permanentSync";

export function usePermanentDocumentSync({
  enabled = true,
  db,
  myself,
  contacts,
  extraAuthors = [],
  addLiveEvents,
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  enabled?: boolean;
  db: StashmapDB | null;
  myself: PublicKey;
  contacts: Contacts;
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
          ...buildPermanentSyncAuthors(myself, contacts),
          ...extraAuthors,
        ]),
      ].sort(),
    [myself, contacts, extraAuthors]
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
      !enabled ||
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
  }, [addLiveEvents, authors, db, enabled, relayPool, relayUrls]);
}
