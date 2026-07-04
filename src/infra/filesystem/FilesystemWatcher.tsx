import { useEffect } from "react";
import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../../core/nodeRef";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { Document, parseToDocument } from "../../core/Document";
import { FsEvent } from "./workspaceWatcher";

function findExistingByFilePath(
  documents: ImmutableMap<string, Document>,
  filePath: string
): Document | undefined {
  return documents.valueSeq().find((doc) => doc.filePath === filePath);
}

function logFilesystemWatcherDebug(
  label: string,
  details: Record<string, unknown>
): void {
  if (process.env.DEBUG_FS_WATCHER !== "1") {
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[filesystem-watcher-debug]", { label, ...details });
}

export function FilesystemWatcher(): null {
  const { workspace } = useBackend();
  const store = useDocumentStore();
  const documents = useDocuments();
  const profile = workspace?.profile;
  const subscribeFsEvents = workspace?.subscribeFsEvents;

  useEffect(() => {
    if (!store || !profile || !subscribeFsEvents) return undefined;
    const handler = (event: FsEvent): void => {
      logFilesystemWatcherDebug("event", {
        type: event.type,
        relativePath: event.relativePath,
        content: event.type === "change" ? event.content : undefined,
        knownDocs: documents
          .valueSeq()
          .map((doc) => ({
            filePath: doc.filePath,
            docId: doc.docId,
            updatedMs: doc.updatedMs,
          }))
          .toArray(),
      });
      if (event.type === "unlink") {
        const existing = findExistingByFilePath(documents, event.relativePath);
        if (existing) {
          logFilesystemWatcherDebug("delete", {
            relativePath: event.relativePath,
            docId: existing.docId,
          });
          store.deleteDocument({
            sourceId: existing.sourceId,
            docId: existing.docId,
            deletedAt: Date.now(),
          });
        }
        return;
      }
      const existing = findExistingByFilePath(documents, event.relativePath);
      // Filename beats content-derived titles, same as the initial scan.
      const pathParts = event.relativePath.split("/");
      const fallbackTitle =
        pathParts[pathParts.length - 1]?.replace(/\.md$/u, "") || undefined;
      const parsed = parseToDocument(LOCAL, event.content, {
        filePath: event.relativePath,
        relativePath: event.relativePath,
        updatedMsOverride: Date.now(),
        ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
        ...(existing && { docIdFallback: existing.docId }),
      });
      logFilesystemWatcherDebug("upsert", {
        relativePath: event.relativePath,
        docId: parsed.document.docId,
        updatedMs: parsed.document.updatedMs,
      });
      store.upsertDocument(parsed);
    };
    return subscribeFsEvents(handler);
  }, [store, profile, documents, subscribeFsEvents]);

  return null;
}
