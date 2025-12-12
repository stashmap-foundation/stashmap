import React, { createContext, useEffect, useState } from "react";
import { useDefaultWorkspace } from "./NostrAuthContext";
import { useData } from "./DataContext";
import { useApis } from "./Apis";
import { replaceUnauthenticatedUser } from "./planner";
import { useWorkspaceFromURL } from "./KnowledgeDataContext";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { ROOT } from "./types";

type WorkspaceContextType = {
  activeWorkspace: LongID;
  setCurrentWorkspace: React.Dispatch<React.SetStateAction<LongID | undefined>>;
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
  const { fileStore } = useApis();
  const wsFromURL = useWorkspaceFromURL();
  const defaultWorkspace = useDefaultWorkspace();
  const [currentWorkspace, setCurrentWorkspace] = useState<LongID | undefined>(
    undefined
  );

  // Simple priority: URL > state > localStorage > default > ROOT
  const activeWorkspace =
    wsFromURL !== undefined
      ? replaceUnauthenticatedUser(wsFromURL, user.publicKey)
      : currentWorkspace ||
        ((user.publicKey !== UNAUTHENTICATED_USER_PK &&
          fileStore.getLocalStorage(
            `${user.publicKey}:activeWs`
          )) as LongID | null) ||
        defaultWorkspace ||
        ROOT;

  // Save to localStorage when changed
  useEffect(() => {
    if (user.publicKey !== UNAUTHENTICATED_USER_PK) {
      fileStore.setLocalStorage(`${user.publicKey}:activeWs`, activeWorkspace);
    }
  }, [activeWorkspace, user.publicKey, fileStore]);

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspace,
        setCurrentWorkspace,
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
