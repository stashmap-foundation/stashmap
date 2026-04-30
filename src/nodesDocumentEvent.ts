import { UnsignedEvent } from "nostr-tools";
import type { Document } from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  msTag,
  newTimestamp,
} from "./nostr";

export function buildDocumentEvent(
  knowledgeDBs: KnowledgeDBs,
  document: Document,
  options?: {
    snapshotDTag?: string;
  }
): UnsignedEvent {
  const systemRoleTags = document.systemRole
    ? ([["s", document.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: document.author,
    created_at: newTimestamp(),
    tags: [["d", document.docId], ...systemRoleTags, msTag()],
    content: renderDocumentMarkdown(knowledgeDBs, document, options),
  };
}

export function buildSnapshotEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  snapshotAuthor: PublicKey,
  snapshotDTag: string,
  sourceDocument: Document
): UnsignedEvent {
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [
      ["d", snapshotDTag],
      ["source", sourceDocument.rootShortId ?? sourceDocument.docId],
      ["source_author", sourceDocument.author],
      msTag(),
    ],
    content: renderDocumentMarkdown(knowledgeDBs, sourceDocument),
  };
}
