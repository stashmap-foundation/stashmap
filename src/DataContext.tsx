import React from "react";
import { Map } from "immutable";
import { newDB } from "./knowledge";
import { injectEmptyNodesIntoKnowledgeDBs } from "./connections";
import { useCachedKnowledgeDBs } from "./EventCache";

export type DataContextProps = Data;

const DataContext = React.createContext<DataContextProps | undefined>(
  undefined
);

export function useData(): DataContextProps {
  const context = React.useContext(DataContext);
  if (context === undefined) {
    throw new Error("DataContext not provided");
  }
  return context;
}

export function DataContextProvider({
  children,
  ...props
}: DataContextProps & {
  children: React.ReactNode;
}): JSX.Element {
  return <DataContext.Provider value={props}>{children}</DataContext.Provider>;
}

function mergeDBNodesAndRelations(
  a: KnowledgeData | undefined,
  b: KnowledgeData | undefined
): KnowledgeData {
  const existing = a || newDB();
  if (b === undefined) {
    return existing;
  }
  const aTombstones = existing.tombstones || Map<ID, ID>();
  const bTombstones = b.tombstones || Map<ID, ID>();
  return {
    nodes: existing.nodes.merge(b.nodes),
    relations: existing.relations.merge(b.relations),
    tombstones: aTombstones.merge(bTombstones),
  };
}

function mergeKnowledgeDBs(a: KnowledgeDBs, b: KnowledgeDBs): KnowledgeDBs {
  const allUsers = a.keySeq().toSet().union(b.keySeq().toSet());
  return Map<PublicKey, KnowledgeData>(
    allUsers.toArray().map((userPK) => {
      return [userPK, mergeDBNodesAndRelations(a.get(userPK), b.get(userPK))];
    })
  );
}

export function MergeKnowledgeDB({
  children,
  knowledgeDBs,
}: {
  children: React.ReactNode;
  knowledgeDBs?: KnowledgeDBs;
}): JSX.Element {
  const data = useData();
  const { temporaryEvents } = data.publishEventsStatus;
  const myself = data.user.publicKey;

  const cachedDBs = useCachedKnowledgeDBs();
  const baseDBs = knowledgeDBs
    ? mergeKnowledgeDBs(knowledgeDBs, cachedDBs)
    : cachedDBs;

  const injectedDBs = injectEmptyNodesIntoKnowledgeDBs(
    baseDBs,
    temporaryEvents,
    myself
  );

  return (
    <DataContext.Provider
      value={{
        ...data,
        knowledgeDBs: injectedDBs,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
