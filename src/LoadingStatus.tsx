import { Filter } from "nostr-tools";
import React from "react";
import {
  useCurrentRelation,
  useDisplayText,
  useCurrentRowID,
} from "./ViewContext";
import { isEmptySemanticID } from "./connections";

const QueryContext = React.createContext<
  { idsBeingQueried: string[]; allEventsProcessed: boolean } | undefined
>(undefined);

export function RegisterQuery({
  children,
  idsBeingQueried,
  allEventsProcessed,
}: {
  children: React.ReactNode;
  idsBeingQueried: string[];
  allEventsProcessed: boolean;
}): JSX.Element {
  return (
    <QueryContext.Provider value={{ idsBeingQueried, allEventsProcessed }}>
      {children}
    </QueryContext.Provider>
  );
}

export function extractIDsFromQueries(filters: Filter[]): string[] {
  return filters.reduce((acc, filter) => {
    return acc.concat(filter["#d"] || []);
  }, [] as string[]);
}

export function useNodeIsLoading(): boolean {
  const relation = useCurrentRelation();
  const [itemID] = useCurrentRowID();
  const displayText = useDisplayText();
  const context = React.useContext(QueryContext);

  if (
    relation ||
    isEmptySemanticID(itemID) ||
    displayText !== "" ||
    !context ||
    context.allEventsProcessed
  ) {
    return false;
  }
  return context.idsBeingQueried.includes(itemID);
}
