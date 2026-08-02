import { Event, UnsignedEvent } from "nostr-tools";
import type { Document } from "./core/Document";
import { documentAudienceTags } from "./core/Document";
import { newStorageKey } from "./storageEncryption";
import {
  KIND_KNOWLEDGE_DEPOSIT,
  KIND_KNOWLEDGE_DOCUMENT,
  msTag,
  newTimestamp,
} from "./nostr";

export function buildDocumentEvent(
  document: Document,
  pubkey: PublicKey,
  content: string
): UnsignedEvent & EventAttachment {
  const systemRoleTags: string[][] = document.systemRole
    ? [["s", document.systemRole]]
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey,
    created_at: newTimestamp(),
    tags: [["d", document.docId], ...systemRoleTags, msTag()],
    content,
    route: { kind: "storage" },
    storageKey: document.storageKey ?? newStorageKey(),
  };
}

export function depositEntityTags(document: Document): string[] {
  return documentAudienceTags(document);
}

export function buildDepositEvent(
  document: Document,
  pubkey: PublicKey,
  content: string,
  createdAt: number
): UnsignedEvent {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error("createdAt must be a non-negative safe integer");
  }
  return {
    kind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey,
    created_at: createdAt,
    tags: [
      ["d", document.docId],
      ...depositEntityTags(document).map((tag) => ["S", tag]),
    ],
    content,
  };
}

function isNewerDeposit(candidate: Event, current: Event): boolean {
  return candidate.created_at !== current.created_at
    ? candidate.created_at > current.created_at
    : candidate.id < current.id;
}

export function selectLatestDepositEvents(events: readonly Event[]): Event[] {
  return [
    ...events
      .filter((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT)
      .reduce((latest, event) => {
        const docId = event.tags.find((tag) => tag[0] === "d")?.[1];
        if (!docId) {
          return latest;
        }
        const key = `${event.kind}:${event.pubkey}:${docId}`;
        const current = latest.get(key);
        return !current || isNewerDeposit(event, current)
          ? new Map(latest).set(key, event)
          : latest;
      }, new Map<string, Event>())
      .values(),
  ];
}
