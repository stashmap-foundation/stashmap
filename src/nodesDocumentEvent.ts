import { UnsignedEvent } from "nostr-tools";
import type { Document } from "./core/Document";
import { newStorageKey } from "./storageEncryption";
import { KIND_KNOWLEDGE_DOCUMENT, msTag, newTimestamp } from "./nostr";

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
