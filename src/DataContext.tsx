import React from "react";
import { Map } from "immutable";
import { newDB } from "./knowledge";
import { injectEmptyNodesIntoKnowledgeDBs } from "./connections";
import {
  useDocumentKnowledgeDBs,
  useDocumentSemanticIndex,
  useDocumentSnapshotNodes,
} from "./DocumentStore";

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

function mergeDBNodesAndNodes(
  a: KnowledgeData | undefined,
  b: KnowledgeData | undefined
): KnowledgeData {
  const existing = a || newDB();
  if (b === undefined) {
    return existing;
  }
  return {
    nodes: existing.nodes.merge(b.nodes),
  };
}

function mergeKnowledgeDBs(a: KnowledgeDBs, b: KnowledgeDBs): KnowledgeDBs {
  const allUsers = a.keySeq().toSet().union(b.keySeq().toSet());
  return Map<PublicKey, KnowledgeData>(
    allUsers.toArray().map((userPK) => {
      return [userPK, mergeDBNodesAndNodes(a.get(userPK), b.get(userPK))];
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

  const documentDBs = useDocumentKnowledgeDBs();
  const semanticIndex = useDocumentSemanticIndex();
  const snapshotNodes = useDocumentSnapshotNodes();
  const mergedDataDBs = mergeKnowledgeDBs(data.knowledgeDBs, documentDBs);
  const baseDBs = knowledgeDBs
    ? mergeKnowledgeDBs(knowledgeDBs, mergedDataDBs)
    : mergedDataDBs;

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
        semanticIndex,
        snapshotNodes,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
