import { useMemo } from "react";
import { useDocumentStore } from "../../../DocumentStore";
import { usePermanentDocumentSync } from "./usePermanentDocumentSync";
import { useCacheDB } from "./CacheDBContext";
import { useData } from "../../../DataContext";
import { useUserRelayContext } from "../../../UserRelayContext";
import { useDefaultRelays } from "../../../NostrAuthContext";
import { splitID } from "../../../connections";

export function PermanentDocumentSyncBridge(): null {
  const db = useCacheDB();
  const addLiveEvents = useDocumentStore()?.addEvents;
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

  usePermanentDocumentSync({
    enabled: db !== undefined,
    db: db || null,
    myself: user.publicKey,
    contacts,
    extraAuthors,
    addLiveEvents,
    defaultRelays,
    userRelays,
    contactsRelays,
  });

  return null;
}
