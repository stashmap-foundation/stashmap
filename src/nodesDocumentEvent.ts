import { UnsignedEvent } from "nostr-tools";
import { shortID } from "./core/connections";
import { renderDocumentMarkdown } from "./documentRenderer";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  msTag,
  newTimestamp,
} from "./nostr";

export function buildDocumentEvent(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  options?: {
    snapshotDTag?: string;
  }
): UnsignedEvent {
  const docId = rootNode.docId ?? shortID(rootNode.id);
  const systemRoleTags = rootNode.systemRole
    ? ([["s", rootNode.systemRole]] as string[][])
    : [];
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: rootNode.author,
    created_at: newTimestamp(),
    tags: [["d", docId], ...systemRoleTags, msTag()],
    content: renderDocumentMarkdown(knowledgeDBs, rootNode, options),
  };
}

export function buildSnapshotEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  snapshotAuthor: PublicKey,
  snapshotDTag: string,
  sourceRootNode: GraphNode
): UnsignedEvent {
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [
      ["d", snapshotDTag],
      ["source", shortID(sourceRootNode.id)],
      ["source_author", sourceRootNode.author],
      msTag(),
    ],
    content: renderDocumentMarkdown(knowledgeDBs, sourceRootNode),
  };
}
