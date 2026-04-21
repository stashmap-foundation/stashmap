import React from "react";
import { Map } from "immutable";
import { useBackend } from "../../BackendContext";
import { useUserOrAnon, useDefaultRelays } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { DocumentStoreProvider } from "../../DocumentStore";
import { PlanningContextProvider } from "../../planner";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptySemanticIndex } from "../../semanticIndex";
import { FilesystemWorkspaceLoader } from "./FilesystemWorkspaceLoader";

export function FilesystemDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const backend = useBackend();
  const defaultRelays = useDefaultRelays();
  const session = useUserSessionState(user);
  const userRelays = backend.workspace?.profile?.relays ?? [];

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
        <MergeKnowledgeDB>
          <PlanningContextProvider
            setPublishEvents={session.setPublishStatus}
            setPanes={session.setPanes}
            setViews={session.setViews}
            db={null}
            getRelays={() => ({
              defaultRelays,
              userRelays,
              contactsRelays: [],
            })}
          >
            <NavigationStateProvider>{children}</NavigationStateProvider>
          </PlanningContextProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
