import React from "react";
import { List, Map } from "immutable";
import { useUser } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { useBackend } from "../../BackendContext";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import {
  DocumentStoreProvider,
  ParsedDocument,
  SnapshotContent,
  useDocumentStore,
} from "../../DocumentStore";
import { LOCAL } from "../../core/nodeRef";
import { PlanningContextProvider } from "../../planner";
import { FilesystemExecutorProvider } from "./FilesystemExecutorProvider";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptyGraphIndex } from "../../graphIndex";
import { FilesystemWatcher } from "./FilesystemWatcher";
import { parseToDocument } from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";
import { WorkspaceMarkdownFile } from "./workspaceBackend";
import { PullSourceProvider } from "../../PullSourceContext";

function fallbackTitleFromRelativePath(relativePath: string): string {
  const pieces = relativePath.split(/[\\/]/);
  const filename = pieces[pieces.length - 1] ?? relativePath;
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function assertUniqueDocIds(documents: ReadonlyArray<ParsedDocument>): void {
  const counts = documents.reduce(
    (acc, parsed) =>
      acc.set(parsed.document.docId, (acc.get(parsed.document.docId) ?? 0) + 1),
    Map<string, number>()
  );
  const duplicates = counts
    .entrySeq()
    .filter(([, count]) => count > 1)
    .map(([docId]) => docId)
    .sort()
    .toArray();
  if (duplicates.length > 0) {
    throw new Error(
      `Workspace contains duplicate knowstr_doc_id values: ${duplicates.join(
        ", "
      )}`
    );
  }
}

function parseWorkspaceFiles(
  files: ReadonlyArray<WorkspaceMarkdownFile>
): ReadonlyArray<ParsedDocument> {
  const result = files.reduce<{
    documents: List<ParsedDocument>;
    context: WalkContext | undefined;
  }>(
    (acc, file) => {
      const fallbackTitle = fallbackTitleFromRelativePath(file.relativePath);
      const parsed = parseToDocument(LOCAL, file.currentContent, {
        filePath: file.relativePath,
        relativePath: file.relativePath,
        ...(fallbackTitle !== "" ? { fallbackTitle } : {}),
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
  );
  const documents = result.documents.toArray();
  assertUniqueDocIds(documents);
  return documents;
}

const SNAPSHOT_LOAD_BATCH_SIZE = 20;

function enqueueSnapshotBatches(
  addSnapshotContents: (snapshots: ReadonlyArray<SnapshotContent>) => void,
  snapshots: ReadonlyArray<SnapshotContent>,
  index: number,
  signal: AbortSignal
): void {
  if (signal.aborted) {
    return;
  }
  const batch = snapshots.slice(index, index + SNAPSHOT_LOAD_BATCH_SIZE);
  if (batch.length === 0) {
    return;
  }
  addSnapshotContents(batch);
  if (index + SNAPSHOT_LOAD_BATCH_SIZE < snapshots.length) {
    window.setTimeout(() =>
      enqueueSnapshotBatches(
        addSnapshotContents,
        snapshots,
        index + SNAPSHOT_LOAD_BATCH_SIZE,
        signal
      )
    );
  }
}

function WorkspaceSnapshotLoader({
  workspaceKey,
}: {
  workspaceKey: string;
}): JSX.Element | null {
  const { workspace } = useBackend();
  const store = useDocumentStore();
  const addSnapshotContents = store?.addSnapshotContents;
  React.useEffect(() => {
    const controller = new AbortController();
    if (!workspace || !addSnapshotContents) {
      return () => controller.abort();
    }
    window.setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
      workspace
        .loadSnapshots()
        .then((snapshots) =>
          enqueueSnapshotBatches(
            addSnapshotContents,
            snapshots,
            0,
            controller.signal
          )
        )
        .catch(() => undefined);
    });
    return () => controller.abort();
  }, [workspace, workspaceKey, addSnapshotContents]);
  return null;
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
      documentByFilePath={Map()}
      relaysInfos={Map()}
      publishEventsStatus={session.publishStatus}
      snapshotNodes={Map()}
      views={session.views}
      panes={session.panes}
    >
      <DocumentStoreProvider
        key={workspaceKey}
        localPubkey={user?.publicKey}
        initialDocuments={initialDocuments}
        initialSnapshots={workspace?.snapshots ?? []}
        unpublishedEvents={session.publishStatus.unsignedEvents}
      >
        <WorkspaceSnapshotLoader workspaceKey={workspaceKey} />
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
