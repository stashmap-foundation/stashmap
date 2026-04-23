import { useEffect } from "react";
import { useDocumentStore } from "../../DocumentStore";
import { useBackend } from "../../BackendContext";

export function FilesystemWorkspaceLoader(): null {
  const upsertDocument = useDocumentStore()?.upsertDocument;
  const documents = useBackend().workspace?.documents;
  useEffect(() => {
    if (!upsertDocument || !documents || documents.length === 0) {
      return;
    }
    documents.forEach((doc) => upsertDocument(doc));
  }, [upsertDocument, documents]);
  return null;
}
