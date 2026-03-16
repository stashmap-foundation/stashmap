import { UnsignedEvent } from "nostr-tools";
import {
  EMPTY_SEMANTIC_ID,
  getNodeContext,
  getSemanticID,
  getNodeText,
  getNode,
  resolveNode,
  isRefNode,
  shortID,
} from "./connections";
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
} from "./nostr";
import { createRootAnchor } from "./rootAnchor";

type SerializeResult = {
  lines: string[];
};

function getSerializableRelationText(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): string {
  return (
    getNodeText(relation) || shortID(getSemanticID(knowledgeDBs, relation))
  );
}

function serializeRelationItems(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  children: GraphNode["children"],
  depth: number,
  current: SerializeResult
): SerializeResult {
  return children.reduce((acc, childID) => {
    const indent = "  ".repeat(depth);
    if (childID === EMPTY_SEMANTIC_ID) {
      return acc;
    }
    const item = getNode(knowledgeDBs, childID, author);
    if (!item) {
      throw new Error(`Missing child relation: ${childID}`);
    }
    if (isRefNode(item)) {
      const targetRelation = resolveNode(knowledgeDBs, item);
      const targetRelationID = item.targetID;
      if (!targetRelationID) {
        return acc;
      }
      const linkText =
        item.linkText ||
        (targetRelation
          ? getSerializableRelationText(knowledgeDBs, targetRelation)
          : "") ||
        shortID(targetRelationID);
      const prefix = formatPrefixMarkers(item.relevance, item.argument);
      return {
        ...acc,
        lines: [
          ...acc.lines,
          `${indent}- ${prefix}[${linkText}](#${targetRelationID})`,
        ],
      };
    }

    const resolvedChild = item;

    const text = getSerializableRelationText(knowledgeDBs, resolvedChild);
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
    return serializeRelationItems(
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
  const rootText = getSerializableRelationText(knowledgeDBs, rootNode);
  const rootUuid = shortID(rootNode.id);
  const serialized = serializeRelationItems(
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
  sourceRootRelation: GraphNode
): UnsignedEvent {
  const snapshotContent = buildDocumentEventFromNodes(
    knowledgeDBs,
    sourceRootRelation
  ).content;
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [
      ["d", snapshotDTag],
      ["source", shortID(sourceRootRelation.id)],
      msTag(),
    ],
    content: snapshotContent,
  };
}
