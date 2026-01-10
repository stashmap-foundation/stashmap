import React, { createContext } from "react";
import { useData } from "./DataContext";
import { replaceUnauthenticatedUser } from "./planner";
import { useWorkspaceFromURL } from "./KnowledgeDataContext";
import { ROOT } from "./types";

type WorkspaceContextType = {
  activeWorkspace: LongID;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
);

export function WorkspaceContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { user } = useData();
  const wsFromURL = useWorkspaceFromURL();

  // Simple: URL node or ROOT
  const activeWorkspace =
    wsFromURL !== undefined
      ? replaceUnauthenticatedUser(wsFromURL, user.publicKey)
      : ROOT;

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextType {
  const context = React.useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error(
      "useWorkspaceContext must be used within a WorkspaceContextProvider"
    );
  }
  return context;
}
