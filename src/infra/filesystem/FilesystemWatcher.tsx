import { useEffect } from "react";
import { Map as ImmutableMap } from "immutable";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { Document, contentToDocument } from "../../Document";
import { FsEvent } from "../../core/workspaceWatcher";

function findExistingByFilePath(
  documents: ImmutableMap<string, Document>,
  filePath: string
): Document | undefined {
  return documents.valueSeq().find((doc) => doc.filePath === filePath);
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
      if (event.type === "unlink") {
        const existing = findExistingByFilePath(documents, event.relativePath);
        if (existing) {
          store.deleteDocument({
            author: existing.author,
            docId: existing.docId,
            deletedAt: Date.now(),
          });
        }
        return;
      }
      const existing = findExistingByFilePath(documents, event.relativePath);
      const doc = existing
        ? { ...existing, updatedMs: Date.now(), content: event.content }
        : contentToDocument(profile.pubkey, event.content, event.relativePath);
      store.upsertDocument(doc);
    };
    return subscribeFsEvents(handler);
  }, [store, profile, documents, subscribeFsEvents]);

  return null;
}
