import React from "react";
import { List, Map } from "immutable";
import { useUserOrAnon } from "../../NostrAuthContext";
import { useUserSessionState } from "../../userSessionState";
import { useBackend } from "../../BackendContext";
import { DataContextProvider, MergeKnowledgeDB } from "../../DataContext";
import { DocumentStoreProvider, ParsedDocument } from "../../DocumentStore";
import { PlanningContextProvider } from "../../planner";
import { FilesystemExecutorProvider } from "./FilesystemExecutorProvider";
import { NavigationStateProvider } from "../../NavigationStateContext";
import { createEmptyGraphIndex } from "../../graphIndex";
import { FilesystemWatcher } from "./FilesystemWatcher";
import { parseToDocument } from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";
import { WorkspaceMarkdownFile } from "./workspaceBackend";

function fallbackTitleFromRelativePath(relativePath: string): string {
  const pieces = relativePath.split(/[\\/]/);
  const filename = pieces[pieces.length - 1] ?? relativePath;
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function assertUniqueDocIds(documents: ReadonlyArray<ParsedDocument>): void {
  const counts = documents.reduce(
    (acc, parsed) => ({
      ...acc,
      [parsed.document.docId]: (acc[parsed.document.docId] || 0) + 1,
    }),
    {} as Record<string, number>
  );
  const duplicates = List(Object.entries(counts))
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
  files: ReadonlyArray<WorkspaceMarkdownFile>,
  author: PublicKey
): ReadonlyArray<ParsedDocument> {
  const result = files.reduce<{
    documents: ParsedDocument[];
    context: WalkContext | undefined;
  }>(
    (acc, file) => {
      const fallbackTitle = fallbackTitleFromRelativePath(file.relativePath);
      const parsed = parseToDocument(author, file.currentContent, {
        filePath: file.relativePath,
        relativePath: file.relativePath,
        ...(fallbackTitle !== "" ? { fallbackTitle } : {}),
        ...(acc.context !== undefined ? { context: acc.context } : {}),
      });
      return {
        documents: [
          ...acc.documents,
          { document: parsed.document, nodes: parsed.nodes },
        ],
        context: parsed.context,
      };
    },
    { documents: [], context: undefined }
  );
  assertUniqueDocIds(result.documents);
  return result.documents;
}

export function FilesystemDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const session = useUserSessionState(user);
  const { workspace } = useBackend();
  const workspaceKey = workspace?.profile?.workspaceDir ?? "no-workspace";
  const initialDocuments = React.useMemo(
    () => parseWorkspaceFiles(workspace?.files ?? [], user.publicKey),
    [workspace?.files, user.publicKey]
  );

  return (
    <DataContextProvider
      user={user}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
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
