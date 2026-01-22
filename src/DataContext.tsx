import React, { useRef } from "react";
import { Map } from "immutable";
import { newDB } from "./knowledge";
import {
  injectEmptyNodesIntoKnowledgeDBs,
  VERSIONS_NODE_ID,
} from "./connections";

const mergeIdCounter = 0;

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
  return {
    nodes: existing.nodes.merge(b.nodes),
    relations: existing.relations.merge(b.relations),
  };
}

export function MergeKnowledgeDB({
  children,
  knowledgeDBs,
}: {
  children: React.ReactNode;
  knowledgeDBs: KnowledgeDBs;
}): JSX.Element {
  const data = useData();
  const { temporaryEvents } = data.publishEventsStatus;
  const myself = data.user.publicKey;

  const existingDBs = data.knowledgeDBs;
  const allUsers = knowledgeDBs
    .keySeq()
    .toSet()
    .union(existingDBs.keySeq().toSet());

  const mergedDBs = Map<PublicKey, KnowledgeData>(
    allUsers.toArray().map((userPK) => {
      return [
        userPK,
        mergeDBNodesAndRelations(
          existingDBs.get(userPK),
          knowledgeDBs.get(userPK)
        ),
      ];
    })
  );

  // Inject empty nodes after merging
  const injectedDBs = injectEmptyNodesIntoKnowledgeDBs(
    mergedDBs,
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
