import { UnsignedEvent } from "nostr-tools";
import {
  EMPTY_SEMANTIC_ID,
  getRelationContext,
  getSemanticID,
  getNodeText,
  getNode,
  resolveNode,
  isRefNode,
  shortID,
} from "./connections";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { KIND_KNOWLEDGE_DOCUMENT, msTag, newTimestamp } from "./nostr";
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
      return {
        ...acc,
        lines: [
          ...acc.lines,
          `${indent}- [${linkText}](#${targetRelationID})${formatNodeAttrs(
            "",
            item.relevance,
            item.argument
          )}`,
        ],
      };
    }

    const resolvedChild = item;

    const text = getSerializableRelationText(knowledgeDBs, resolvedChild);
    const next: SerializeResult = {
      lines: [
        ...acc.lines,
        `${indent}- ${text}${formatNodeAttrs(
          shortID(resolvedChild.id),
          item.relevance,
          item.argument,
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

export function buildDocumentEventFromRelations(
  knowledgeDBs: KnowledgeDBs,
  rootRelation: GraphNode
): UnsignedEvent {
  const rootText = getSerializableRelationText(knowledgeDBs, rootRelation);
  const rootUuid = shortID(rootRelation.id);
  const serialized = serializeRelationItems(
    knowledgeDBs,
    rootRelation.author,
    rootRelation.children,
    0,
    {
      lines: [],
    }
  );
  const systemRoleTags = rootRelation.systemRole
    ? ([["s", rootRelation.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: rootRelation.author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...systemRoleTags, msTag()],
    content: `${[
      formatRootHeading(
        rootText,
        rootUuid,
        rootRelation.anchor ??
          createRootAnchor(getRelationContext(knowledgeDBs, rootRelation)),
        rootRelation.systemRole
      ),
      ...serialized.lines,
    ].join("\n")}\n`,
  };
}
