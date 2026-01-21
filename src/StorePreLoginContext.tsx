import React from "react";
import { List } from "immutable";
import { useDebouncedCallback } from "use-debounce";
import { useApis } from "./Apis";
import { KIND_CONTACTLIST, KIND_VIEWS } from "./nostr";
import { planAddContacts, planUpdateViews, usePlanner } from "./planner";
import { execute } from "./executor";

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

  const storeMergeEvents = useDebouncedCallback(
    async (eventKinds: List<number>) => {
      if (eventKinds.size === 0) {
        return;
      }
      const plan = createPlan();
      const withViews = eventKinds.includes(KIND_VIEWS)
        ? planUpdateViews(plan, plan.views)
        : plan;
      const withContacts = eventKinds.includes(KIND_CONTACTLIST)
        ? planAddContacts(withViews, withViews.contacts.keySeq().toList())
        : withViews;
      const results = await execute({
        plan: withContacts,
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
