import { Event, UnsignedEvent } from "nostr-tools";
import type { Document } from "./core/Document";
import { parseToDocument } from "./core/Document";
import {
  authorPubkeyOf,
  isThingAddress,
  resolveLink,
  thingTagOf,
} from "./core/linkPath";
import { pathOf } from "./core/nodeRef";
import { newStorageKey } from "./storageEncryption";
import { getEventMs } from "./nostrEvents";
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

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const differenceIndex = leftBytes.findIndex(
    (byte, index) => byte !== rightBytes[index]
  );
  if (differenceIndex >= 0 && differenceIndex < rightBytes.length) {
    return leftBytes[differenceIndex] - rightBytes[differenceIndex];
  }
  return leftBytes.length - rightBytes.length;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

export function depositLinkTags(
  path: string,
  pubkey: PublicKey,
  content: string
): string[][] {
  const links = parseToDocument(pubkey, content, { path })
    .nodes.valueSeq()
    .toArray()
    .flatMap((node) =>
      node.spans.flatMap((span) =>
        span.kind === "link" ? [{ href: span.href, from: node.id }] : []
      )
    );
  const files = links.flatMap(({ href, from }) => {
    const target = resolveLink(href, { sourceId: pubkey, id: from });
    const author = target ? authorPubkeyOf(target.sourceId) : undefined;
    if (!target || !author || isThingAddress(target.id)) return [];
    const targetPath = pathOf(target.id);
    return author === pubkey && targetPath === path
      ? []
      : [`${KIND_KNOWLEDGE_DEPOSIT}:${author}:${targetPath}`];
  });
  const things = links.flatMap(({ href }) => {
    const tag = thingTagOf(href);
    return tag ? [tag] : [];
  });
  return [
    ...sortedUnique(files).map((value) => ["a", value]),
    ...sortedUnique(things).map((value) => ["i", value]),
  ];
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
      ...depositLinkTags(document.docId, pubkey, content),
      msTag(),
    ],
    content,
  };
}

function depositOrder(event: Event): [number, number, string] {
  return [event.created_at, getEventMs(event), event.id];
}

function isNewerDeposit(candidate: Event, current: Event): boolean {
  const candidateOrder = depositOrder(candidate);
  const currentOrder = depositOrder(current);
  return (
    candidateOrder[0] > currentOrder[0] ||
    (candidateOrder[0] === currentOrder[0] &&
      (candidateOrder[1] > currentOrder[1] ||
        (candidateOrder[1] === currentOrder[1] &&
          candidateOrder[2] > currentOrder[2])))
  );
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
