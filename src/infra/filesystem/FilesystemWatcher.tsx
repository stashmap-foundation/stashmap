import { useEffect } from "react";
import { LOCAL } from "../../core/nodeRef";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import {
  documentKeyOf,
  fileNameTitle,
  parseToDocument,
} from "../../core/Document";
import { FsEvent } from "./workspaceWatcher";

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
          .map((doc) => ({ docId: doc.docId, updatedMs: doc.updatedMs }))
          .toArray(),
      });
      if (event.type === "unlink") {
        if (documents.has(documentKeyOf(LOCAL, event.relativePath))) {
          logFilesystemWatcherDebug("delete", {
            relativePath: event.relativePath,
          });
          store.deleteDocument({
            sourceId: LOCAL,
            docId: event.relativePath,
            deletedAt: Date.now(),
          });
        }
        return;
      }
      const parsed = parseToDocument(LOCAL, event.content, {
        path: event.relativePath,
        fallbackTitle: fileNameTitle(event.relativePath),
        updatedMsOverride: Date.now(),
      });
      logFilesystemWatcherDebug("upsert", {
        relativePath: event.relativePath,
        updatedMs: parsed.document.updatedMs,
      });
      store.upsertDocument(parsed);
    };
    return subscribeFsEvents(handler);
  }, [store, profile, documents, subscribeFsEvents]);

  return null;
}
