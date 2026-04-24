import React from "react";
import { Map } from "immutable";
import { useUserOrAnon } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { DocumentStoreProvider } from "../../DocumentStore";
import { PlanningContextProvider } from "../../planner";
import { FilesystemExecutorProvider } from "./FilesystemExecutorProvider";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptySemanticIndex } from "../../semanticIndex";
import { FilesystemWorkspaceLoader } from "./FilesystemWorkspaceLoader";
import { FilesystemWatcher } from "./FilesystemWatcher";

export function FilesystemDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const session = useUserSessionState(user);

  return (
    <DataContextProvider
      contacts={Map()}
      user={user}
      contactsRelays={Map()}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
      semanticIndex={createEmptySemanticIndex()}
      relaysInfos={Map()}
      publishEventsStatus={session.publishStatus}
      snapshotNodes={Map()}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <FilesystemWorkspaceLoader />
        <FilesystemWatcher />
        <MergeKnowledgeDB>
          <FilesystemExecutorProvider
            setPublishEvents={session.setPublishStatus}
            setPanes={session.setPanes}
            setViews={session.setViews}
          >
            <PlanningContextProvider
              setPublishEvents={session.setPublishStatus}
              setPanes={session.setPanes}
              setViews={session.setViews}
            >
              <NavigationStateProvider>{children}</NavigationStateProvider>
            </PlanningContextProvider>
          </FilesystemExecutorProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
