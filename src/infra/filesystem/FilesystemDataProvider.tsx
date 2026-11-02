import React from "react";
import { List, Map } from "immutable";
import { useUser } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { useBackend } from "../../BackendContext";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { DocumentStoreProvider, ParsedDocument } from "../../DocumentStore";
import { LOCAL } from "../../core/nodeRef";
import { PlanningContextProvider } from "../../planner";
import { FilesystemExecutorProvider } from "./FilesystemExecutorProvider";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptyGraphIndex } from "../../graphIndex";
import { FilesystemWatcher } from "./FilesystemWatcher";
import { fileNameTitle, parseToDocument } from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";
import { WorkspaceMarkdownFile } from "./workspaceBackend";
import { PullSourceProvider } from "../../PullSourceContext";

function parseWorkspaceFiles(
  files: ReadonlyArray<WorkspaceMarkdownFile>
): ReadonlyArray<ParsedDocument> {
  return files
    .reduce<{
      documents: List<ParsedDocument>;
      context: WalkContext | undefined;
    }>(
      (acc, file) => {
        const parsed = parseToDocument(LOCAL, file.currentContent, {
          path: file.relativePath,
          fallbackTitle: fileNameTitle(file.relativePath),
          ...(acc.context !== undefined ? { context: acc.context } : {}),
        });
        return {
          documents: acc.documents.push({
            document: parsed.document,
            nodes: parsed.nodes,
          }),
          context: parsed.context,
        };
      },
      { documents: List<ParsedDocument>(), context: undefined }
    )
    .documents.toArray();
}

export function FilesystemDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUser();
  const session = useUserSessionState(user);
  const { workspace } = useBackend();
  const workspaceKey = workspace?.profile?.workspaceDir ?? "no-workspace";
  const initialDocuments = React.useMemo(
    () => parseWorkspaceFiles(workspace?.files ?? []),
    [workspace?.files]
  );

  return (
    <DataContextProvider
      user={user}
      knowledgeDBs={Map<SourceId, KnowledgeData>()}
      graphIndex={createEmptyGraphIndex()}
      documents={Map()}
      publishEventsStatus={session.publishStatus}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        key={workspaceKey}
        localPubkey={user?.publicKey}
        initialDocuments={initialDocuments}
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <FilesystemWatcher />
        <MergeKnowledgeDB>
          <PullSourceProvider>
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
          </PullSourceProvider>
        </MergeKnowledgeDB>
      </DocumentStoreProvider>
    </DataContextProvider>
  );
}
