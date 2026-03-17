import React from "react";
import {
  injectEmptyNodesIntoKnowledgeDBs,
  mergeKnowledgeDBs,
} from "../../graph/queries";
import {
  useDocumentKnowledgeDBs,
  useDocumentSemanticIndex,
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
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
