import React from "react";
import { List } from "immutable";
import { useDebouncedCallback } from "use-debounce";
import { useApis } from "./Apis";
import { useExecutor } from "./ExecutorContext";
import { KIND_CONTACTLIST } from "./nostr";
import { planAddContacts, usePlanner } from "./planner";

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
  const { timeToStorePreLoginEvents } = useApis();
  const executor = useExecutor();

  const storeMergeEvents = useDebouncedCallback(
    async (eventKinds: List<number>) => {
      if (eventKinds.size === 0) {
        return;
      }
      const plan = createPlan();
      const withContacts = eventKinds.includes(KIND_CONTACTLIST)
        ? planAddContacts(plan, plan.contacts.keySeq().toList())
        : plan;
      await executor.executePlan(withContacts);
      setPublishEvents((current) => ({
        ...current,
        preLoginEvents: List(),
      }));
    },
    timeToStorePreLoginEvents
  );

  return (
    <StorePreLoginDataContext.Provider value={storeMergeEvents}>
      {children}
    </StorePreLoginDataContext.Provider>
  );
}
