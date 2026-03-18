import React from "react";
import { List } from "immutable";
import { useDebouncedCallback } from "use-debounce";
import { useApis } from "./ApiContext";
import { KIND_CONTACTLIST } from "../../infra/nostrCore";
import { planAddContacts } from "../../graph/commands";
import { usePlanner } from "./PlannerContext";
import { execute } from "../../infra/nostr";
import { useRelaysToCreatePlan } from "./useRelays";

type StorePreLoginData = (eventKinds: List<number>) => void;

const StorePreLoginDataContext = React.createContext<
  StorePreLoginData | undefined
>(undefined);

export function useStorePreLoginEvents(): StorePreLoginData {
  const context = React.useContext(StorePreLoginDataContext);
  if (context === undefined) {
    throw new Error("StorePreLoginDataContext not provided");
  }
  return context;
}

export function StorePreLoginContext({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { createPlan, setPublishEvents } = usePlanner();
  const { relayPool, finalizeEvent, timeToStorePreLoginEvents } = useApis();
  const relays = useRelaysToCreatePlan();

  const storeMergeEvents = useDebouncedCallback(
    async (eventKinds: List<number>) => {
      if (eventKinds.size === 0) {
        return;
      }
      const plan = createPlan();
      const withContacts = eventKinds.includes(KIND_CONTACTLIST)
        ? planAddContacts(plan, plan.contacts.keySeq().toList())
        : plan;
      const results = await execute({
        events: withContacts.publishEvents,
        user: withContacts.user,
        relays,
        relayPool,
        finalizeEvent,
      });
      setPublishEvents((current) => {
        return {
          unsignedEvents: current.unsignedEvents,
          results,
          isLoading: false,
          preLoginEvents: List(),
          temporaryView: current.temporaryView,
          temporaryEvents: current.temporaryEvents,
        };
      });
    },
    timeToStorePreLoginEvents
  );

  return (
    <StorePreLoginDataContext.Provider value={storeMergeEvents}>
      {children}
    </StorePreLoginDataContext.Provider>
  );
}
