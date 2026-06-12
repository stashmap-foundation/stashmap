import { UnsignedEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Document } from "./core/Document";
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
  document: Document,
  pubkey: PublicKey,
  content: string
): UnsignedEvent {
  const systemRoleTags = document.systemRole
    ? ([["s", document.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey,
    created_at: newTimestamp(),
    tags: [["d", document.docId], ...systemRoleTags, msTag()],
    content,
  };
}

export function buildSnapshotEvent(
  snapshotAuthor: PublicKey,
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
