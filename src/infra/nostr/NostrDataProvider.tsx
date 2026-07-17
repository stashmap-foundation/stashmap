import React, { useEffect, useMemo } from "react";
import { List, Map } from "immutable";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_SETTINGS,
  KIND_RELAY_METADATA_EVENT,
} from "../../nostr";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { useBackend } from "../../BackendContext";
import { PlanningContextProvider } from "../../planner";
import { NostrExecutorProvider } from "./NostrExecutorProvider";
import { useUserRelayContext } from "../../UserRelayContext";
import { usePreloadRelays } from "../../relays";
import { useDefaultRelays, useUser } from "../../NostrAuthContext";
import { useEventQuery } from "../../commons/useNostrQuery";
import { getOutboxEvents } from "./cache/indexedDB";
import { useCacheDB } from "./cache/CacheDBContext";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { processEvents } from "../../eventProcessing";
import { DocumentStoreProvider } from "../../DocumentStore";
import { NostrCacheSync } from "./cache/NostrCacheSync";
import { createEmptyGraphIndex } from "../../graphIndex";
import { useUserSessionState } from "../../userSessionState";
import { PullSourceProvider } from "../../PullSourceContext";

export const KIND_SEARCH = [KIND_KNOWLEDGE_DOCUMENT];

export const KINDS_META = [KIND_SETTINGS];

export function NostrDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUser();
  const myPublicKey = user?.publicKey;
  const session = useUserSessionState(user);
  const { userRelays } = useUserRelayContext();
  const defaultRelays = useDefaultRelays();
  const backend = useBackend();

  const db = useCacheDB();

  useEffect(() => {
    if (!db) {
      return undefined;
    }
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

  const { eose: metaEventsEose } = useEventQuery(
    backend,
    [
      {
        authors: myPublicKey ? [myPublicKey] : [],
        kinds: [KIND_SETTINGS],
        limit: 1,
      },
    ],
    {
      readFromRelays: usePreloadRelays({
        user: true,
      }),
    }
  );
  const extraAuthors = useMemo(
    () => [...new globalThis.Set(session.panes.map((pane) => pane.sourceId))],
    [session.panes]
  );

  const { events: paneRelayEvents } = useEventQuery(
    backend,
    [
      {
        authors: extraAuthors.filter((a) => a !== myPublicKey),
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

  const processedPaneRelayEvents = processEvents(
    paneRelayEvents.valueSeq().toList()
  );

  const paneRelays = processedPaneRelayEvents.reduce((rdx, p, key) => {
    return rdx.set(key, p.relays);
  }, Map<PublicKey, Relays>());
  return (
    <DataContextProvider
      user={user}
      knowledgeDBs={Map<SourceId, KnowledgeData>()}
      graphIndex={createEmptyGraphIndex()}
      documents={Map()}
      documentByFilePath={Map()}
      relaysInfos={Map<string, RelayInformation | undefined>()}
      publishEventsStatus={session.publishStatus}
      snapshotNodes={Map()}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        localPubkey={myPublicKey}
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <NostrCacheSync paneRelays={paneRelays} />
        <MergeKnowledgeDB>
          <PullSourceProvider>
            <NostrExecutorProvider
              setPublishEvents={session.setPublishStatus}
              setPanes={session.setPanes}
              setViews={session.setViews}
              getRelays={() => ({
                defaultRelays,
                userRelays,
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
          </PullSourceProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
