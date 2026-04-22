import React from "react";
import { List } from "immutable";
import { Event } from "nostr-tools";
import type { Plan } from "./planner";

export type Executor = {
  executePlan: (plan: Plan) => Promise<void>;
  republishEvents: (events: List<Event>, relayUrl: string) => Promise<void>;
};

const ExecutorContext = React.createContext<Executor | undefined>(undefined);

export function useExecutor(): Executor {
  const context = React.useContext(ExecutorContext);
  if (context === undefined) {
    throw new Error("useExecutor must be used within an ExecutorProvider");
  }
  return context;
}

export function ExecutorProvider({
  executor,
  children,
}: {
  executor: Executor;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <ExecutorContext.Provider value={executor}>
      {children}
    </ExecutorContext.Provider>
  );
}
