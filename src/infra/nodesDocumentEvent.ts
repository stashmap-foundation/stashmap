import { UnsignedEvent } from "nostr-tools";
import {
  createRootAnchor,
  EMPTY_SEMANTIC_ID as EMPTY_NODE_ID,
  getNode,
  getNodeContext,
  getNodeText,
  getSemanticID,
  isRefNode,
  resolveNode,
  shortID,
  type GraphNode,
  type KnowledgeDBs,
  type PublicKey,
} from "../graph/public";
import {
  formatNodeAttrs,
  formatPrefixMarkers,
  formatRootHeading,
} from "./documentFormat";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  msTag,
  newTimestamp,
} from "./nostrCore";

type SerializeResult = {
  lines: string[];
};

function getSerializableNodeText(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string {
  return getNodeText(node) || shortID(getSemanticID(knowledgeDBs, node));
}

function serializeNodeItems(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  children: GraphNode["children"],
  depth: number,
  current: SerializeResult
): SerializeResult {
  return children.reduce((acc, childID) => {
    const indent = "  ".repeat(depth);
    if (childID === EMPTY_NODE_ID) {
      return acc;
    }
    const item = getNode(knowledgeDBs, childID, author);
    if (!item) {
      throw new Error(`Missing child node: ${childID}`);
    }
    if (isRefNode(item)) {
      const targetNode = resolveNode(knowledgeDBs, item);
      const targetNodeID = item.targetID;
      if (!targetNodeID) {
        return acc;
      }
      const linkText =
        item.linkText ||
        (targetNode ? getSerializableNodeText(knowledgeDBs, targetNode) : "") ||
        shortID(targetNodeID);
      const prefix = formatPrefixMarkers(item.relevance, item.argument);
      return {
        ...acc,
        lines: [
          ...acc.lines,
          `${indent}- ${prefix}[${linkText}](#${targetNodeID})`,
        ],
      };
    }

    const resolvedChild = item;

    const text = getSerializableNodeText(knowledgeDBs, resolvedChild);
    const prefix = formatPrefixMarkers(item.relevance, item.argument);
    const next: SerializeResult = {
      lines: [
        ...acc.lines,
        `${indent}- ${prefix}${text}${formatNodeAttrs(
          shortID(resolvedChild.id),
          {
            ...(resolvedChild.basedOn
              ? { basedOn: resolvedChild.basedOn }
              : {}),
            ...(resolvedChild.userPublicKey
              ? { userPublicKey: resolvedChild.userPublicKey }
              : {}),
          }
        )}`,
      ],
    };
    return serializeNodeItems(
      knowledgeDBs,
      author,
      resolvedChild.children,
      depth + 1,
      next
    );
  }, current);
}

export function buildDocumentEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  options?: {
    snapshotDTag?: string;
  }
): UnsignedEvent {
  const rootText = getSerializableNodeText(knowledgeDBs, rootNode);
  const rootUuid = shortID(rootNode.id);
  const serialized = serializeNodeItems(
    knowledgeDBs,
    rootNode.author,
    rootNode.children,
    0,
    {
      lines: [],
    }
  );
  const systemRoleTags = rootNode.systemRole
    ? ([["s", rootNode.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: rootNode.author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...systemRoleTags, msTag()],
    content: `${[
      formatRootHeading(
        rootText,
        rootUuid,
        rootNode.basedOn,
        options?.snapshotDTag ?? rootNode.snapshotDTag,
        rootNode.anchor ??
          createRootAnchor(getNodeContext(knowledgeDBs, rootNode)),
        rootNode.systemRole
      ),
      ...serialized.lines,
    ].join("\n")}\n`,
  };
}

export function buildSnapshotEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  snapshotAuthor: PublicKey,
  snapshotDTag: string,
  sourceRootNode: GraphNode
): UnsignedEvent {
  const snapshotContent = buildDocumentEventFromNodes(
    knowledgeDBs,
    sourceRootNode
  ).content;
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [
      ["d", snapshotDTag],
      ["source", shortID(sourceRootNode.id)],
      msTag(),
    ],
    content: snapshotContent,
  };
}
