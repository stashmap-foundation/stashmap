import React from "react";
import { List } from "immutable";
import { useDebouncedCallback } from "use-debounce";
import { getWriteRelays } from "citadel-commons";
import { useApis } from "./Apis";
import { KIND_RELATION_TYPES, KIND_VIEWS, KIND_WORKSPACES } from "./nostr";
import {
  planUpdateRelationTypes,
  planUpdateViews,
  planUpdateWorkspaces,
  usePlanner,
} from "./planner";
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
      const withWorkspaces = eventKinds.includes(KIND_WORKSPACES)
        ? planUpdateWorkspaces(plan, plan.workspaces, plan.activeWorkspace)
        : plan;
      const withViews = eventKinds.includes(KIND_VIEWS)
        ? planUpdateViews(withWorkspaces, withWorkspaces.views)
        : withWorkspaces;
      const withRelationTypes = eventKinds.includes(KIND_RELATION_TYPES)
        ? planUpdateRelationTypes(withViews, withViews.relationTypes)
        : withViews;

      const results = await execute({
        plan: withRelationTypes,
        relayPool,
        relays: getWriteRelays(plan.relays),
        finalizeEvent,
      });
      setPublishEvents((current) => {
        return {
          unsignedEvents: current.unsignedEvents,
          results,
          isLoading: false,
          preLoginEvents: List(),
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