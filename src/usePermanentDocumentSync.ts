import { Map } from "immutable";
import { useEffect, useMemo } from "react";
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
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  db: StashmapDB | null;
  myself: PublicKey;
  contacts: Contacts;
  projectMembers: Members;
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: Map<PublicKey, Relays>;
}): void {
  const { relayPool } = useApis();
  const authors = useMemo(
    () => buildPermanentSyncAuthors(myself, contacts, projectMembers),
    [myself, contacts, projectMembers]
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
    if (!db || relayUrls.length === 0 || authors.length === 0) {
      return () => {};
    }
    return startPermanentDocumentSync({
      db,
      relayPool,
      relayUrls,
      authors,
    });
  }, [authors, db, relayPool, relayUrls]);
}
