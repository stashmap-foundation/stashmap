import type { Map as ImmutableMap } from "immutable";
import type { StashmapDB } from "../../infra/indexedDB";
import { useDocumentStore } from "./DocumentStore";
import { usePermanentDocumentSync } from "./usePermanentDocumentSync";

export function PermanentDocumentSyncBridge({
  db,
  myself,
  contacts,
  extraAuthors,
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  db: StashmapDB | null | undefined;
  myself: PublicKey;
  contacts: Contacts;
  extraAuthors: PublicKey[];
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: ImmutableMap<PublicKey, Relays>;
}): JSX.Element | null {
  const addLiveEvents = useDocumentStore()?.addEvents;

  usePermanentDocumentSync({
    enabled: db !== undefined,
    db: db || null,
    myself,
    contacts,
    extraAuthors,
    addLiveEvents,
    defaultRelays,
    userRelays,
    contactsRelays,
  });

  return null;
}
