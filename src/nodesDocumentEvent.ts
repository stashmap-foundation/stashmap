import { UnsignedEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Document } from "./core/Document";
import { publishStateOf } from "./core/knowstrFrontmatter";
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

// Whether any tag involves an asset entity. Ladder rungs are space-joined
// sets, so the asset id can sit anywhere inside a rung, not only at the
// start of a bare tag.
export function hasAssetEntityTag(tags: string[]): boolean {
  return tags.some((tag) =>
    tag.split(" ").some((id) => id.startsWith("asset:"))
  );
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

// Deposits route to the document's declared relays (knowstr_publish.relays
// — a per-document choice that REPLACES the configured set and travels with
// the deposit as intent). Without a declared choice, asset documents go to
// the asset relay ONLY (the v0 cheat: rgb contract documents live on the
// deedsats relay), everything else to the user's configured write relays,
// or else the defaults.
export function depositWriteRelayConf(
  document: Document,
  userRelays: Relays,
  assetRelay: string | undefined = ASSET_ENTITY_RELAY
): WriteRelayConf {
  const declared = publishStateOf(document.frontMatter)?.relays;
  const hasAssetEntity = hasAssetEntityTag(depositEntityTags(document));
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
