import { Filter } from "nostr-tools";
import React from "react";
import { useNode, useNodeID } from "./ViewContext";

const QueryContext = React.createContext<
  { nodesBeeingQueried: string[]; allEventsProcessed: boolean } | undefined
>(undefined);

export function RegisterQuery({
  children,
  nodesBeeingQueried,
  allEventsProcessed,
}: {
  children: React.ReactNode;
  nodesBeeingQueried: string[];
  allEventsProcessed: boolean;
}): JSX.Element {
  return (
    <QueryContext.Provider value={{ nodesBeeingQueried, allEventsProcessed }}>
      {children}
    </QueryContext.Provider>
  );
}

export function extractNodesFromQueries(filters: Filter[]): string[] {
  return filters.reduce((acc, filter) => {
    return acc.concat(filter["#d"] || []);
  }, [] as string[]);
}

export function useNodeIsLoading(): boolean {
  const [node] = useNode();
  const [nodeID] = useNodeID();
  const context = React.useContext(QueryContext);

  if (node || !context || context.allEventsProcessed) {
    return false;
  }
  return context.nodesBeeingQueried.includes(nodeID);
}
