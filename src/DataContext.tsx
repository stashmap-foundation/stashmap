import React from "react";
import { Map } from "immutable";
import { LOCAL } from "./core/nodeRef";
import { newDB } from "./core/knowledge";
import { injectEmptyNodesIntoKnowledgeDBs } from "./core/connections";
import {
  useDocumentKnowledgeDBs,
  useDocumentGraphIndex,
  useDocumentSnapshotNodes,
  useDocuments,
  useDocumentByFilePath,
} from "./DocumentStore";
import { mergeGraphIndexes } from "./graphIndex";
import type { Document as KnowstrDocument } from "./core/Document";

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
  return Map<SourceId, KnowledgeData>(
    allUsers.toArray().map((userPK) => {
      return [userPK, mergeDBNodesAndNodes(a.get(userPK), b.get(userPK))];
    })
  );
}

export function MergeKnowledgeDB({
  children,
  knowledgeDBs,
  graphIndex,
  documents,
  documentByFilePath,
  snapshotNodes,
  pull,
}: {
  children: React.ReactNode;
  knowledgeDBs?: KnowledgeDBs;
  graphIndex?: GraphIndex;
  documents?: Map<string, KnowstrDocument>;
  documentByFilePath?: Map<string, KnowstrDocument>;
  snapshotNodes?: SnapshotNodes;
  pull?: PullOverlayData;
}): JSX.Element {
  const data = useData();
  const { temporaryEvents } = data.publishEventsStatus;

  const documentDBs = useDocumentKnowledgeDBs();
  const documentGraphIndex = useDocumentGraphIndex();
  const documentSnapshotNodes = useDocumentSnapshotNodes();
  const documentRecords = useDocuments();
  const documentsByPath = useDocumentByFilePath();
  const mergedDataDBs = mergeKnowledgeDBs(data.knowledgeDBs, documentDBs);
  const baseDBs = knowledgeDBs
    ? mergeKnowledgeDBs(knowledgeDBs, mergedDataDBs)
    : mergedDataDBs;
  const mergedGraphIndex = graphIndex
    ? mergeGraphIndexes(
        mergeGraphIndexes(data.graphIndex, documentGraphIndex),
        graphIndex
      )
    : mergeGraphIndexes(data.graphIndex, documentGraphIndex);
  const mergedDocuments = documents
    ? documentRecords.merge(data.documents).merge(documents)
    : documentRecords.merge(data.documents);
  const mergedDocumentByFilePath = documentByFilePath
    ? documentsByPath.merge(data.documentByFilePath).merge(documentByFilePath)
    : documentsByPath.merge(data.documentByFilePath);
  const mergedSnapshotNodes = snapshotNodes
    ? data.snapshotNodes.merge(documentSnapshotNodes).merge(snapshotNodes)
    : data.snapshotNodes.merge(documentSnapshotNodes);

  const injectedDBs = injectEmptyNodesIntoKnowledgeDBs(
    baseDBs,
    temporaryEvents,
    LOCAL
  );

  return (
    <DataContext.Provider
      value={{
        ...data,
        knowledgeDBs: injectedDBs,
        graphIndex: mergedGraphIndex,
        snapshotNodes: mergedSnapshotNodes,
        documents: mergedDocuments,
        documentByFilePath: mergedDocumentByFilePath,
        pull: pull ?? data.pull,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
