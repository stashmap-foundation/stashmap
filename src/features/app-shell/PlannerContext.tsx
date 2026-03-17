import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { Event } from "nostr-tools";
import { List, Set as ImmutableSet } from "immutable";
import type { ID } from "../../graph/types";
import type {
  AllRelays,
  Relays,
  RepublishEvents,
} from "../../infra/publishTypes";
import type { Pane, Views } from "../../session/types";
import {
  buildDocumentEvents,
  createPublishQueue,
  execute,
  republishEvents,
} from "../../infra/nostr";
import { useApis } from "./ApiContext";
import type { StashmapDB } from "../../infra/indexedDB";
import { useData } from "./DataContext";
import { useRelaysToCreatePlan } from "./useRelays";
import { mergePublishResultsOfEvents } from "../shared/PublishingStatus";
import { createPlan } from "../../app/actions";
import type { Plan } from "../../app/types";
import type { EventState } from "./types";

type ExecutePlan = (plan: Plan) => Promise<void>;

type Planner = {
  createPlan: () => Plan;
  executePlan: ExecutePlan;
  republishEvents: RepublishEvents;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

type PlanningContextValue = Pick<
  Planner,
  "executePlan" | "republishEvents" | "setPublishEvents"
> & {
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

const PlanningContext = React.createContext<PlanningContextValue | undefined>(
  undefined
);

function createEmptyRelays(): AllRelays {
  return {
    defaultRelays: [] as Relays,
    userRelays: [] as Relays,
    contactsRelays: [] as Relays,
  };
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
  setPanes,
  setViews,
  db,
  getRelays,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
  db?: StashmapDB | null;
  getRelays?: () => AllRelays;
}): JSX.Element {
  const { relayPool, finalizeEvent } = useApis();
  const { user } = useData();
  const depsRef = useRef({
    user,
    relays: getRelays ? getRelays() : createEmptyRelays(),
    relayPool,
    finalizeEvent,
  });
  // eslint-disable-next-line functional/immutable-data
  depsRef.current = {
    user,
    relays: getRelays ? getRelays() : depsRef.current.relays,
    relayPool,
    finalizeEvent,
  };

  const setPublishEventsRef = useRef(setPublishEvents);
  // eslint-disable-next-line functional/immutable-data
  setPublishEventsRef.current = setPublishEvents;

  const queueRef = useRef<ReturnType<typeof createPublishQueue> | null>(null);

  useEffect(() => {
    if (!db) return () => {};
    const queue = createPublishQueue({
      db,
      getDeps: () => depsRef.current,
      onResults: (results) => {
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
      relayPool,
      finalizeEvent,
    });

    setPublishEvents((prevStatus) => ({
      ...prevStatus,
      results: mergePublishResultsOfEvents(prevStatus.results, results),
      isLoading: false,
    }));
  };

  const republishEventsOnRelay = async (
    events: List<Event>,
    relayUrl: string
  ): Promise<void> => {
    const results = await republishEvents({
      events,
      relayPool,
      writeRelayUrl: relayUrl,
    });
    setPublishEvents((prevStatus) => ({
      ...prevStatus,
      results: mergePublishResultsOfEvents(prevStatus.results, results),
      isLoading: false,
    }));
  };

  return (
    <PlanningContext.Provider
      value={{
        executePlan,
        republishEvents: republishEventsOnRelay,
        setPublishEvents,
        setPanes,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export function usePlanner(): Planner {
  const data = useData();
  const relays = useRelaysToCreatePlan();
  const createPlanningContext = (): Plan => {
    return createPlan({
      ...data,
      relays,
    });
  };
  const planningContext = React.useContext(PlanningContext);
  if (planningContext === undefined) {
    throw new Error("PlanningContext not provided");
  }

  return {
    createPlan: createPlanningContext,
    executePlan: planningContext.executePlan,
    republishEvents: planningContext.republishEvents,
    setPublishEvents: planningContext.setPublishEvents,
    setPanes: planningContext.setPanes,
  };
}
