import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Set as ImmutableSet } from "immutable";
import { Event } from "nostr-tools";
import { useApis } from "../../Apis";
import { useBackend } from "../../BackendContext";
import { useData } from "../../DataContext";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, Plan } from "../../planner";
import { execute, republishEvents } from "./executor";
import { createPublishQueue } from "./cache/PublishQueue";
import { useCacheDB } from "./cache/CacheDBContext";
import { mergePublishResultsOfEvents } from "../../commons/PublishingStatus";

export function NostrExecutorProvider({
  setPublishEvents,
  setPanes,
  setViews,
  getRelays,
  children,
}: {
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
  getRelays: () => AllRelays;
  children: React.ReactNode;
}): JSX.Element {
  const { finalizeEvent } = useApis();
  const backend = useBackend();
  const { user } = useData();
  const db = useCacheDB();

  const depsRef = useRef({
    user,
    relays: getRelays(),
    backend,
    finalizeEvent,
  });
  // eslint-disable-next-line functional/immutable-data
  depsRef.current = {
    user,
    relays: getRelays(),
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
    setPanes(plan.panes);
    setViews(plan.views);
    const filteredEvents = buildDocumentEvents(plan);

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
        preLoginEvents: prevStatus.preLoginEvents,
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
      affectedRoots: ImmutableSet<ID>(),
    };

    const results = await execute({
      plan: filteredPlan,
      backend,
      finalizeEvent,
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
