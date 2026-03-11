import { Set as ImmutableSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  getConcreteRefTargetRelation,
  getRelationContext,
  getRelationSemanticID,
  getRelationText,
  getRelationsNoReferencedBy,
  hashText,
  isConcreteRefId,
  parseConcreteRefId,
  shortID,
} from "./connections";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { KIND_KNOWLEDGE_DOCUMENT, msTag, newTimestamp } from "./nostr";
import { createRootAnchor } from "./rootAnchor";

type SerializeResult = {
  lines: string[];
  nodeHashes: ImmutableSet<string>;
  semanticIDs: ImmutableSet<string>;
  relationUUIDs: ImmutableSet<string>;
};

function getSerializableRelationText(relation: Relations): string {
  return getRelationText(relation) || shortID(getRelationSemanticID(relation));
}

function serializeRelationItems(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  items: Relations["items"],
  depth: number,
  current: SerializeResult
): SerializeResult {
  return items.reduce((acc, item) => {
    const indent = "  ".repeat(depth);
    if (isConcreteRefId(item.id)) {
      const parsed = parseConcreteRefId(item.id);
      if (!parsed) {
        return acc;
      }
      const targetRelation = getConcreteRefTargetRelation(
        knowledgeDBs,
        item.id,
        author
      );
      const linkText =
        item.linkText ||
        (targetRelation ? getSerializableRelationText(targetRelation) : "") ||
        shortID(parsed.relationID);
      const targetRelationID = targetRelation?.id || parsed.relationID;
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
        nodeHashes: targetRelation
          ? acc.nodeHashes.add(targetRelation.textHash)
          : acc.nodeHashes,
        semanticIDs: targetRelation
          ? acc.semanticIDs.add(getRelationSemanticID(targetRelation))
          : acc.semanticIDs,
        relationUUIDs: acc.relationUUIDs.add(shortID(targetRelationID as ID)),
      };
    }

    const childRelation = getRelationsNoReferencedBy(
      knowledgeDBs,
      item.id,
      author
    );
    const resolvedChild =
      childRelation ||
      knowledgeDBs.get(author)?.relations.get(shortID(item.id as ID));
    if (!resolvedChild) {
      throw new Error(`Missing child relation: ${item.id}`);
    }

    const text = getSerializableRelationText(resolvedChild);
    const next: SerializeResult = {
      lines: [
        ...acc.lines,
        `${indent}- ${text}${formatNodeAttrs(
          shortID(resolvedChild.id),
          item.relevance,
          item.argument,
          {
            semanticID: getRelationSemanticID(resolvedChild),
            ...(resolvedChild.basedOn
              ? { basedOn: resolvedChild.basedOn }
              : {}),
            ...(resolvedChild.userPublicKey
              ? { userPublicKey: resolvedChild.userPublicKey }
              : {}),
          }
        )}`,
      ],
      nodeHashes: acc.nodeHashes.add(resolvedChild.textHash),
      semanticIDs: acc.semanticIDs.add(getRelationSemanticID(resolvedChild)),
      relationUUIDs: acc.relationUUIDs.add(shortID(resolvedChild.id)),
    };
    return serializeRelationItems(
      knowledgeDBs,
      author,
      resolvedChild.items,
      depth + 1,
      next
    );
  }, current);
}

export function buildDocumentEventFromRelations(
  knowledgeDBs: KnowledgeDBs,
  rootRelation: Relations
): UnsignedEvent {
  const rootSemanticID = getRelationSemanticID(rootRelation);
  const rootText = getSerializableRelationText(rootRelation);
  const rootUuid = shortID(rootRelation.id);
  const serialized = serializeRelationItems(
    knowledgeDBs,
    rootRelation.author,
    rootRelation.items,
    0,
    {
      lines: [],
      nodeHashes: ImmutableSet<string>(),
      semanticIDs: ImmutableSet<string>(),
      relationUUIDs: ImmutableSet<string>(),
    }
  );
  const nTags = serialized.nodeHashes
    .add(rootRelation.textHash || hashText(rootText))
    .union(serialized.semanticIDs.add(rootSemanticID))
    .toArray()
    .map((value) => ["n", value]);
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
    tags: [["d", rootUuid], ...nTags, ...rTags, ...systemRoleTags, msTag()],
    content: `${[
      formatRootHeading(
        rootText,
        rootUuid,
        rootSemanticID,
        rootRelation.anchor ??
          createRootAnchor(getRelationContext(knowledgeDBs, rootRelation)),
        rootRelation.systemRole
      ),
      ...serialized.lines,
    ].join("\n")}\n`,
  };
}
