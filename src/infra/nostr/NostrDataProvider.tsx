import React, { useEffect, useMemo, useState } from "react";
import { List, Map } from "immutable";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_CONTACTLIST,
  KIND_SETTINGS,
  KIND_RELAY_METADATA_EVENT,
} from "../../nostr";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { useApis } from "../../Apis";
import { useBackend } from "../../BackendContext";
import { PlanningContextProvider } from "../../planner";
import { NostrExecutorProvider } from "./NostrExecutorProvider";
import { useUserRelayContext } from "../../UserRelayContext";
import { flattenRelays, usePreloadRelays } from "../../relays";
import { useDefaultRelays, useUserOrAnon } from "../../NostrAuthContext";
import { useEventQuery } from "../../commons/useNostrQuery";
import { getOutboxEvents } from "./cache/indexedDB";
import { useCacheDB } from "./cache/CacheDBContext";
import { splitID } from "../../core/connections";
import { NavigationStateProvider } from "../../NavigationStateContext";
import {
  mergeEvents,
  newProcessedEvents,
  processEvents,
} from "../../eventProcessing";
import { DocumentStoreProvider } from "../../DocumentStore";
import { NostrCacheSync } from "./cache/NostrCacheSync";
import { createEmptySemanticIndex } from "../../semanticIndex";
import { useUserSessionState } from "../../userSessionState";

export const KIND_SEARCH = [KIND_KNOWLEDGE_DOCUMENT];

export const KINDS_META = [KIND_SETTINGS, KIND_CONTACTLIST];

function useRelaysInfo(
  relays: Array<Relay>,
  eose: boolean
): Map<string, RelayInformation | undefined> {
  const { nip11 } = useApis();
  const [infos, setInfos] = useState<Map<string, RelayInformation | undefined>>(
    Map<string, RelayInformation | undefined>()
  );
  useEffect(() => {
    if (!eose) {
      return;
    }
    const controller = new AbortController();

    (async () => {
      const fetchedInfos = await Promise.all(
        relays.map(
          async (relay): Promise<[string, RelayInformation | undefined]> => {
            try {
              const info = await nip11.fetchRelayInformation(relay.url);
              return [relay.url, info];
            } catch {
              return [relay.url, undefined];
            }
          }
        )
      );
      if (controller.signal.aborted) {
        return;
      }
      setInfos(Map(fetchedInfos));
    })();
    return () => controller.abort();
  }, [JSON.stringify(relays.map((r) => r.url)), eose]);
  return infos;
}

export function NostrDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const myPublicKey = user.publicKey;
  const session = useUserSessionState(user);
  const { isRelaysLoaded, userRelays } = useUserRelayContext();
  const defaultRelays = useDefaultRelays();
  const backend = useBackend();

  const db = useCacheDB();

  useEffect(() => {
    if (!db) return;
    const controller = new AbortController();
    getOutboxEvents(db).then((outbox) => {
      if (controller.signal.aborted) {
        return;
      }
      if (outbox.length > 0) {
        session.setPublishStatus((prev) => ({
          ...prev,
          unsignedEvents: prev.unsignedEvents.concat(
            List(outbox.map((entry) => entry.event))
          ),
        }));
      }
    });
    return () => controller.abort();
  }, [db]);

  const { events: mE, eose: metaEventsEose } = useEventQuery(
    backend,
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
    .merge(session.publishStatus.unsignedEvents);

  const processedMetaEvents = mergeEvents(
    processEvents(metaEvents).get(myPublicKey, newProcessedEvents()),
    session.publishStatus.preLoginEvents
  );
  const contacts = processedMetaEvents.contacts.filter(
    (_, k) => k !== myPublicKey
  );

  const extraAuthors = useMemo(
    () => [
      ...new globalThis.Set(
        session.panes.flatMap((pane) =>
          pane.rootNodeId
            ? [pane.author, splitID(pane.rootNodeId)[0] || pane.author]
            : [pane.author]
        )
      ),
    ],
    [session.panes]
  );

  const { events: contactRelayEvents } = useEventQuery(
    backend,
    [
      {
        authors: [
          ...new globalThis.Set([
            ...contacts.keySeq().toArray(),
            ...extraAuthors.filter((a) => a !== myPublicKey),
          ]),
        ],
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
  return (
    <DataContextProvider
      contacts={contacts}
      user={user}
      contactsRelays={contactsRelays}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
      semanticIndex={createEmptySemanticIndex()}
      documents={Map()}
      documentByFilePath={Map()}
      relaysInfos={Map<string, RelayInformation | undefined>()}
      publishEventsStatus={session.publishStatus}
      snapshotNodes={Map()}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <NostrCacheSync />
        <MergeKnowledgeDB>
          <NostrExecutorProvider
            setPublishEvents={session.setPublishStatus}
            setPanes={session.setPanes}
            setViews={session.setViews}
            getRelays={() => ({
              defaultRelays,
              userRelays,
              contactsRelays: flattenRelays(contactsRelays),
            })}
          >
            <PlanningContextProvider
              setPublishEvents={session.setPublishStatus}
              setPanes={session.setPanes}
              setViews={session.setViews}
            >
              <NavigationStateProvider>{children}</NavigationStateProvider>
            </PlanningContextProvider>
          </NostrExecutorProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
