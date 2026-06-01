import React from "react";
import { Map } from "immutable";
import { injectEmptyNodesIntoKnowledgeDBs } from "./core/connections";
import {
  useDocumentGraphData,
  useDocumentSnapshotNodes,
} from "./DocumentStore";
import {
  GraphDataFields,
  createEmptyGraphData,
  graphDataFromKnowledgeDBs,
  mergeGraphData,
  projectKnowledgeDBs,
} from "./core/graphData";

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

function graphDataFromData(data: Data): GraphDataFields {
  return {
    nodesByID: data.nodesByID,
    documents: data.documents,
    documentsByFilePath: data.documentsByFilePath,
    incomingCrefs: data.incomingCrefs,
    incomingFileLinks: data.incomingFileLinks,
    basedOnIndex: data.basedOnIndex,
    semantic: data.semantic,
    nodeKeysByDocument: data.nodeKeysByDocument,
  };
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

  const documentGraphData = useDocumentGraphData();
  const snapshotNodes = useDocumentSnapshotNodes();
  const mergedData = mergeGraphData(graphDataFromData(data), documentGraphData);
  const baseGraphData = knowledgeDBs
    ? mergeGraphData(graphDataFromKnowledgeDBs(knowledgeDBs), mergedData)
    : mergedData;

  const injectedKnowledgeDBs = injectEmptyNodesIntoKnowledgeDBs(
    projectKnowledgeDBs(baseGraphData),
    temporaryEvents,
    myself
  );
  const injectedGraphData =
    temporaryEvents.size > 0
      ? graphDataFromKnowledgeDBs(injectedKnowledgeDBs, {
          documents: baseGraphData.documents,
          documentsByFilePath: baseGraphData.documentsByFilePath,
        })
      : baseGraphData;

  return (
    <DataContext.Provider
      value={{
        ...data,
        ...injectedGraphData,
        snapshotNodes,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const EMPTY_GRAPH_DATA = createEmptyGraphData();
export const EMPTY_CONTACTS = Map<PublicKey, Contact>();
