import React from "react";
import { mergeKnowledgeDBs } from "../../graph/queries";
import type { KnowledgeDBs } from "../../graph/types";
import { computeEmptyNodeMetadata } from "../../session/temporaryNodes";
import { injectEmptyNodesIntoKnowledgeDBs } from "../../rows/temporaryNodes";
import type { Data } from "./types";
import {
  useGraphKnowledgeDBs,
  useGraphSemanticIndex,
  useGraphSnapshots,
  useGraphSnapshotStatuses,
} from "./GraphProvider";

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

  const documentDBs = useGraphKnowledgeDBs();
  const semanticIndex = useGraphSemanticIndex();
  const snapshots = useGraphSnapshots();
  const snapshotStatuses = useGraphSnapshotStatuses();
  const mergedDataDBs = mergeKnowledgeDBs(data.knowledgeDBs, documentDBs);
  const baseDBs = knowledgeDBs
    ? mergeKnowledgeDBs(knowledgeDBs, mergedDataDBs)
    : mergedDataDBs;

  const emptyNodeMetadata = computeEmptyNodeMetadata(temporaryEvents);
  const injectedDBs = injectEmptyNodesIntoKnowledgeDBs(
    baseDBs,
    emptyNodeMetadata,
    myself
  );

  return (
    <DataContext.Provider
      value={{
        ...data,
        knowledgeDBs: injectedDBs,
        semanticIndex,
        snapshots,
        snapshotStatuses,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
