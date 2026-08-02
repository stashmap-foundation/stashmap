import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Set as ImmutableSet } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useApis } from "../../Apis";
import { useBackend } from "../../BackendContext";
import { useData } from "../../DataContext";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, buildDocumentWrites, Plan } from "../../planner";
import { buildDepositEvent } from "../../nodesDocumentEvent";
import { newTimestamp } from "../../nostr";
import { execute, republishEvents } from "./executor";
import { createPublishQueue } from "./cache/PublishQueue";
import { useCacheDB } from "./cache/CacheDBContext";
import { mergePublishResultsOfEvents } from "../../commons/PublishingStatus";

function buildDepositEvents(
  plan: Plan,
  roomConfigured: boolean
): List<UnsignedEvent & EventAttachment> {
  if (!roomConfigured || !plan.user) {
    return List();
  }
  const pubkey = plan.user.publicKey;
  const createdAt = newTimestamp();
  return List(
    buildDocumentWrites(plan).map((write): UnsignedEvent & EventAttachment => ({
      ...buildDepositEvent(write.document, pubkey, write.content, createdAt),
      route: { kind: "shared" },
    }))
  );
}

export function NostrExecutorProvider({
  setPublishEvents,
  setPanes,
  setViews,
  children,
}: {
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
  children: React.ReactNode;
}): JSX.Element {
  const { finalizeEvent } = useApis();
  const backend = useBackend();
  const { user } = useData();
  const db = useCacheDB();

  const depsRef = useRef({
    user,
    workspaceConfig: backend.workspaceConfig,
    backend,
    finalizeEvent,
  });
  // eslint-disable-next-line functional/immutable-data
  depsRef.current = {
    user,
    workspaceConfig: backend.workspaceConfig,
    backend,
    finalizeEvent,
  };

  const setPublishEventsRef = useRef(setPublishEvents);
  // eslint-disable-next-line functional/immutable-data
  setPublishEventsRef.current = setPublishEvents;

  const mountedRef = useRef(true);
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data
    mountedRef.current = true;
    return () => {
      // eslint-disable-next-line functional/immutable-data
      mountedRef.current = false;
    };
  }, []);

  const queueRef = useRef<ReturnType<typeof createPublishQueue> | null>(null);

  useEffect(() => {
    queueRef.current?.wake();
  }, [backend.workspaceConfig]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    if (!db) return () => {};
    const queue = createPublishQueue({
      db,
      getDeps: () => depsRef.current,
      onResults: (results) => {
        if (!mountedRef.current) return;
        setPublishEventsRef.current((prevStatus) => ({
          ...prevStatus,
          results: mergePublishResultsOfEvents(prevStatus.results, results),
          isLoading: false,
          queueStatus: queueRef.current?.getStatus(),
        }));
      },
    });
    // eslint-disable-next-line functional/immutable-data
    queueRef.current = queue;
    queue.init().then(() => {
      if (!mountedRef.current) return;
      setPublishEventsRef.current((prev) => ({
        ...prev,
        queueStatus: queue.getStatus(),
      }));
    });
    return () => {
      // eslint-disable-next-line functional/immutable-data
      queueRef.current = null;
      queue.destroy();
    };
  }, [db]);

  const executePlan = async (plan: Plan): Promise<void> => {
    if (plan.paneUpdate) {
      setPanes(plan.panes);
    }
    setViews(plan.views);
    const storageEvents = buildDocumentEvents(plan);
    const depositEvents = buildDepositEvents(
      plan,
      backend.workspaceConfig.roomRelays.length > 0
    );
    const filteredEvents = storageEvents.concat(depositEvents);

    if (filteredEvents.size === 0) {
      setPublishEvents((prevStatus) => {
        const newTemporaryEvents = prevStatus.temporaryEvents.concat(
          plan.temporaryEvents
        );
        return {
          ...prevStatus,
          temporaryView: plan.temporaryView,
          temporaryEvents: newTemporaryEvents,
        };
      });
      return;
    }

    setPublishEvents((prevStatus) => {
      const newTemporaryEvents = prevStatus.temporaryEvents.concat(
        plan.temporaryEvents
      );
      return {
        unsignedEvents: prevStatus.unsignedEvents.concat(filteredEvents),
        results: prevStatus.results,
        isLoading: !queueRef.current,
        temporaryView: plan.temporaryView,
        temporaryEvents: newTemporaryEvents,
      };
    });

    if (queueRef.current) {
      queueRef.current.enqueue(filteredEvents);
      setPublishEvents((prev) => ({
        ...prev,
        queueStatus: queueRef.current?.getStatus(),
      }));
      return;
    }

    const filteredPlan = {
      ...plan,
      publishEvents: filteredEvents,
      affectedDocuments: ImmutableSet<string>(),
    };

    const results = await execute({
      plan: filteredPlan,
      backend,
      finalizeEvent,
      workspaceConfig: backend.workspaceConfig,
    });

    if (!mountedRef.current) {
      return;
    }
    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  const republishEventsOnRelay = async (
    events: List<Event>,
    relayUrl: string
  ): Promise<void> => {
    const results = await republishEvents({
      events,
      backend,
      writeRelayUrl: relayUrl,
    });
    if (!mountedRef.current) {
      return;
    }
    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  return (
    <ExecutorProvider
      executor={{
        executePlan,
        republishEvents: republishEventsOnRelay,
      }}
    >
      {children}
    </ExecutorProvider>
  );
}
