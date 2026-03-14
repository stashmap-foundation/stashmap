import { Set as ImmutableSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  EMPTY_SEMANTIC_ID,
  getConcreteRefTargetRelation,
  getRelationContext,
  getSemanticID,
  getRelationText,
  getNode,
  getRefTargetID,
  isRefNode,
  shortID,
} from "./connections";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { KIND_KNOWLEDGE_DOCUMENT, msTag, newTimestamp } from "./nostr";
import { createRootAnchor } from "./rootAnchor";

type SerializeResult = {
  lines: string[];
  relationUUIDs: ImmutableSet<string>;
};

function getSerializableRelationText(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): string {
  return (
    getRelationText(relation) || shortID(getSemanticID(knowledgeDBs, relation))
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
      const targetRelation = getConcreteRefTargetRelation(
        knowledgeDBs,
        item.id,
        author
      );
      const targetRelationID = getRefTargetID(item);
      if (!targetRelationID) {
        return acc;
      }
      const linkText =
        item.linkText ||
        (targetRelation
          ? getSerializableRelationText(knowledgeDBs, targetRelation)
          : "") ||
        shortID(targetRelationID);
      const hrefTarget = targetRelation?.id || targetRelationID;
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
        relationUUIDs: acc.relationUUIDs.add(shortID(hrefTarget as ID)),
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
      relationUUIDs: acc.relationUUIDs.add(shortID(resolvedChild.id)),
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
      relationUUIDs: ImmutableSet<string>(),
    }
  );
  const rTags = serialized.relationUUIDs
    .add(rootUuid)
    .toArray()
    .map((uuid) => ["r", uuid]);
  const systemRoleTags = rootRelation.systemRole
    ? ([["s", rootRelation.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: rootRelation.author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...rTags, ...systemRoleTags, msTag()],
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
