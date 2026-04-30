import React from "react";
import { Map } from "immutable";
import { useUserOrAnon } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { useBackend } from "../../BackendContext";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { DocumentStoreProvider, ParsedDocument } from "../../DocumentStore";
import { PlanningContextProvider } from "../../planner";
import { FilesystemExecutorProvider } from "./FilesystemExecutorProvider";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptySemanticIndex } from "../../semanticIndex";
import { FilesystemWatcher } from "./FilesystemWatcher";

export function FilesystemDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const session = useUserSessionState(user);
  const { workspace } = useBackend();
  const workspaceKey = workspace?.profile?.workspaceDir ?? "no-workspace";
  const initialDocuments: ReadonlyArray<ParsedDocument> = (
    workspace?.documents ?? []
  ).map((doc) => ({ document: doc, nodes: doc.nodes }));

  return (
    <DataContextProvider
      contacts={Map()}
      user={user}
      contactsRelays={Map()}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
      semanticIndex={createEmptySemanticIndex()}
      documents={Map()}
      documentByFilePath={Map()}
      relaysInfos={Map()}
      publishEventsStatus={session.publishStatus}
      snapshotNodes={Map()}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        key={workspaceKey}
        initialDocuments={initialDocuments}
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
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
