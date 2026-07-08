import { useEffect, useMemo } from "react";
import { Event, UnsignedEvent } from "nostr-tools";
import { useBackend } from "./BackendContext";
import { useData } from "./DataContext";
import {
  useDocumentKnowledgeDBs,
  useDocuments,
  useDocumentStore,
} from "./DocumentStore";
import { usePaneTreeResult } from "./editor/TreeView";
import { documentKeyOf, Document } from "./core/Document";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";
import { depositEntityTags } from "./nodesDocumentEvent";
import { isCanonicalId } from "./core/entityRecognition";
import { useRelaysToCreatePlan } from "./relays";
import { getReadRelays, uniqueRelayUrls } from "./relayUtils";

// Attention-driven pull (CP4): opening a document subscribes deposits
// (34774) for that document's tags — its roots, its granted entities, and
// the entity ids its rows link to. Results stream into the footers while
// you look; the subscription drops on close. No standing queries: you
// cannot look at more documents than you can look at.

// PoW filtering on entity tags starts at zero (a config constant, not a
// policy) — raise it when spam arrives, not before.
export const PULL_ENTITY_POW_MIN = 0;

function leadingZeroBits(hex: string): number {
  const chars = hex.split("");
  const firstNonZero = chars.findIndex((c) => c !== "0");
  if (firstNonZero === -1) {
    return chars.length * 4;
  }
  const nibble = parseInt(chars[firstNonZero], 16);
  if (Number.isNaN(nibble)) {
    return firstNonZero * 4;
  }
  return firstNonZero * 4 + Math.clz32(nibble) - 28;
}

function passesPow(event: Event | UnsignedEvent): boolean {
  if (PULL_ENTITY_POW_MIN === 0) return true;
  const { id } = event as Event;
  return id !== undefined && leadingZeroBits(id) >= PULL_ENTITY_POW_MIN;
}

// The tags a document's attention justifies: exactly the set its own
// deposit would carry — roots, granted entities, referenced entities.
export function pullTagsForDocument(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): string[] {
  return depositEntityTags(
    document,
    knowledgeDBs.get(document.sourceId)?.nodes
  );
}

export function usePaneAttentionPull(): void {
  const backend = useBackend();
  const data = useData();
  const store = useDocumentStore();
  const documents = useDocuments();
  const knowledgeDBs = useDocumentKnowledgeDBs();
  const treeResult = usePaneTreeResult();
  const relays = useRelaysToCreatePlan();
  const myPubkey = data.user?.publicKey;
  const addDepositEvents = store?.addDepositEvents;

  // The pane's document is what the pane RENDERS: the tree's root row
  // carries its docId — pane fields don't.
  const rootRow = treeResult?.rows.first(undefined);
  const docId = rootRow?.node.docId;
  const sourceId = rootRow?.sourceId;
  const rootId = rootRow?.node.id;
  const tagsKey = useMemo(() => {
    if (docId && sourceId) {
      const document = documents.get(documentKeyOf(sourceId, docId));
      if (!document) return "";
      return [...new Set(pullTagsForDocument(knowledgeDBs, document))]
        .sort()
        .join(" ");
    }
    // The computed pin (E6): a document-less canonical root is the
    // degenerate one-tag pane.
    return rootId && isCanonicalId(rootId) ? rootId : "";
  }, [docId, sourceId, rootId, documents, knowledgeDBs]);

  const relaysKey = useMemo(
    () =>
      uniqueRelayUrls(
        getReadRelays([...relays.defaultRelays, ...relays.userRelays])
      ).join(" "),
    [relays]
  );

  useEffect(() => {
    const tags = tagsKey === "" ? [] : tagsKey.split(" ");
    const relayUrls = relaysKey === "" ? [] : relaysKey.split(" ");
    if (!addDepositEvents || tags.length === 0 || relayUrls.length === 0) {
      return undefined;
    }
    const sub = backend.subscribe(
      relayUrls,
      [{ kinds: [KIND_KNOWLEDGE_DEPOSIT], "#S": tags }],
      {
        onevent: (event: Event): void => {
          if (event.kind !== KIND_KNOWLEDGE_DEPOSIT) return;
          // Own deposits are already local truth.
          if (myPubkey && event.pubkey === myPubkey) return;
          if (!passesPow(event)) return;
          addDepositEvents([event]);
        },
      }
    );
    return () => sub.close();
  }, [backend, addDepositEvents, myPubkey, tagsKey, relaysKey]);
}

export function PaneAttentionPull(): JSX.Element | null {
  usePaneAttentionPull();
  return null;
}
