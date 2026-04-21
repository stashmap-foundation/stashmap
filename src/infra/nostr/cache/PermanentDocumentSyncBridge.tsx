import { Map } from "immutable";
import { useDocumentStore } from "../../../DocumentStore";
import { usePermanentDocumentSync } from "./usePermanentDocumentSync";
import { useCacheDB } from "./CacheDBContext";

export function PermanentDocumentSyncBridge({
  myself,
  contacts,
  extraAuthors,
  defaultRelays,
  userRelays,
  contactsRelays,
}: {
  myself: PublicKey;
  contacts: Contacts;
  extraAuthors: PublicKey[];
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: Map<PublicKey, Relays>;
}): null {
  const db = useCacheDB();
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
