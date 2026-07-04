import { UnsignedEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Document } from "./core/Document";
import { publishStateOf } from "./core/knowstrFrontmatter";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  KIND_KNOWLEDGE_DEPOSIT,
  msTag,
  newTimestamp,
} from "./nostr";

export function snapshotIdForContent(content: string): string {
  return `snap_sha256_${bytesToHex(sha256(new TextEncoder().encode(content)))}`;
}

export function isValidSnapshotId(snapshotId: string): boolean {
  return /^snap_sha256_[0-9a-f]{64}$/u.test(snapshotId);
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

// The S set is {own roots} ∪ knowstr_publish.entities (interop rule: tags
// and content sit inside one signature and MUST agree). Roots stay implicit
// in the frontmatter; entities is the carried record of granted audiences.
export function depositEntityTags(document: Document): string[] {
  const entities = publishStateOf(document.frontMatter)?.entities ?? [];
  return [...new Set([...document.topNodeShortIds, ...entities])];
}

export function buildDepositEvent(
  document: Document,
  pubkey: PublicKey,
  content: string
): UnsignedEvent {
  const systemRoleTags = document.systemRole
    ? ([["s", document.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey,
    created_at: newTimestamp(),
    tags: [
      ["d", document.docId],
      ...depositEntityTags(document).map((id) => ["S", id]),
      ...systemRoleTags,
      msTag(),
    ],
    content,
  };
}

// Deposits route to the user's configured write relays plus the document's
// declared relays (knowstr_publish.relays — intent, travels with the
// deposit) plus scheme defaults: asset: entities bring their pinned relay
// from app config (the deedsats demo relay).
export function depositWriteRelayConf(
  document: Document,
  assetRelay: string | undefined = process.env.REACT_APP_ASSET_RELAY
): WriteRelayConf {
  const declared = publishStateOf(document.frontMatter)?.relays ?? [];
  const scheme =
    assetRelay &&
    depositEntityTags(document).some((tag) => tag.startsWith("asset:"))
      ? [assetRelay]
      : [];
  return {
    user: true,
    extraRelays: [...new Set([...declared, ...scheme])].map((url) => ({
      url,
      read: false,
      write: true,
    })),
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
