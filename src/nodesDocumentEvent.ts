import { UnsignedEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Document } from "./core/Document";
import { publishStateOf } from "./core/knowstrFrontmatter";
import { newStorageKey } from "./storageEncryption";
import { getWriteRelays } from "./relayUtils";
import {
  ASSET_ENTITY_RELAY,
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

// The filesystem snapshot store (idea.md, Baselines travel with the
// workspace): content-addressed, write-once, committed like any other
// file. Lives here (not in workspaceBackend) so the renderer can compute
// paths without importing fs.
export const SNAPSHOTS_DIR = ".knowstr/snapshots";

export function snapshotRelativePath(snapshotId: string): string {
  return `${SNAPSHOTS_DIR}/${snapshotId}.md`;
}

export function buildDocumentEvent(
  document: Document,
  pubkey: PublicKey,
  content: string
): UnsignedEvent & EventAttachment {
  const systemRoleTags = document.systemRole
    ? ([["s", document.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey,
    created_at: newTimestamp(),
    tags: [["d", document.docId], ...systemRoleTags, msTag()],
    content,
    storageKey: document.storageKey ?? newStorageKey(),
  };
}

export function depositEntityTags(document: Document): string[] {
  return [
    ...new Set([...document.topNodeShortIds, ...document.realWorldEntities]),
  ];
}

export function hasAssetEntityTag(tags: readonly string[]): boolean {
  return tags.some((tag) =>
    tag.split(" ").some((id) => id.startsWith("asset:"))
  );
}

export function buildDepositEvent(
  document: Document,
  pubkey: PublicKey,
  content: string,
  tags: readonly string[]
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
      ...tags.map((id) => ["S", id]),
      ...systemRoleTags,
      msTag(),
    ],
    content,
  };
}

// Deposits route to the document's declared relays (knowstr_publish.relays
// — a per-document choice that REPLACES the configured set and travels with
// the deposit as intent). Without a declared choice, asset documents go to
// the asset relay ONLY (the v0 cheat: rgb contract documents live on the
// deedsats relay), everything else to the user's configured write relays,
// or else the defaults.
export function depositWriteRelayConf(
  document: Document,
  userRelays: Relays,
  tags: readonly string[],
  assetRelay: string | undefined = ASSET_ENTITY_RELAY
): WriteRelayConf {
  const declared = publishStateOf(document.frontMatter)?.relays;
  const hasAssetEntity = hasAssetEntityTag(tags);
  const scheme = assetRelay && hasAssetEntity ? [assetRelay] : [];
  const toRelay = (url: string): Relay => ({ url, read: false, write: true });
  if (declared !== undefined) {
    return {
      extraRelays: [...new Set([...declared, ...scheme])].map(toRelay),
    };
  }
  if (scheme.length > 0) {
    return { extraRelays: scheme.map(toRelay) };
  }
  const hasConfigured = getWriteRelays(userRelays).length > 0;
  return {
    ...(hasConfigured ? { user: true } : { defaultRelays: true }),
    extraRelays: [],
  };
}

// Encrypted under the forking document's storage key: whoever can read the
// fork holds this content since fork time anyway — they gain only the
// ability to diff. The d tag is computed from the plaintext BEFORE the wire
// envelope, so filesystem and web ids agree.
export function buildSnapshotEvent(
  snapshotAuthor: PublicKey,
  content: string,
  storageKey: string
): UnsignedEvent & EventAttachment {
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [["d", snapshotIdForContent(content)], msTag()],
    content,
    storageKey,
  };
}
