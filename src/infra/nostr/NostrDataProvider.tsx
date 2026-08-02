import React from "react";
import { Map } from "immutable";
import { useUser } from "../../NostrAuthContext";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { PlanningContextProvider } from "../../planner";
import { createEmptyGraphIndex } from "../../graphIndex";
import { useUserSessionState } from "../../userSessionState";
import { DocumentStoreProvider } from "../../DocumentStore";
import { PullSourceProvider } from "../../PullSourceContext";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { NostrCacheSync } from "./cache/NostrCacheSync";
import { NostrExecutorProvider } from "./NostrExecutorProvider";

export function NostrDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUser();
  const session = useUserSessionState(user);

  return (
    <DataContextProvider
      user={user}
      knowledgeDBs={Map<SourceId, KnowledgeData>()}
      graphIndex={createEmptyGraphIndex()}
      documents={Map()}
      documentByFilePath={Map()}
      publishEventsStatus={session.publishStatus}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        localPubkey={user?.publicKey}
        initialDocuments={[]}
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <MergeKnowledgeDB>
          <PullSourceProvider>
            <NostrCacheSync />
            <NostrExecutorProvider
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
            </NostrExecutorProvider>
          </PullSourceProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
