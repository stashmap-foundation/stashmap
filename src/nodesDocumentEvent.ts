import { UnsignedEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Document } from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  msTag,
  newTimestamp,
} from "./nostr";

export function snapshotIdForContent(content: string): string {
  return `snap_sha256_${bytesToHex(sha256(new TextEncoder().encode(content)))}`;
}

export function buildDocumentEvent(
  knowledgeDBs: KnowledgeDBs,
  document: Document,
  pubkey: PublicKey,
  options?: {
    snapshotId?: string;
  }
): UnsignedEvent {
  const systemRoleTags = document.systemRole
    ? ([["s", document.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey,
    created_at: newTimestamp(),
    tags: [["d", document.docId], ...systemRoleTags, msTag()],
    content: renderDocumentMarkdown(knowledgeDBs, document, options),
  };
}

function snapshotEventForContent(
  snapshotAuthor: PublicKey,
  sourceDocument: Document,
  content: string
): UnsignedEvent {
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [["d", snapshotIdForContent(content)], msTag()],
    content,
  };
}

export function buildSnapshotEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  snapshotAuthor: PublicKey,
  sourceDocument: Document
): UnsignedEvent {
  return snapshotEventForContent(
    snapshotAuthor,
    sourceDocument,
    renderDocumentMarkdown(knowledgeDBs, sourceDocument)
  );
}
