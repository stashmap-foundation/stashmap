/* eslint-disable functional/immutable-data */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import {
  createConcreteRefId,
  createSemanticID,
  ensureRelationNativeFields,
  hashText,
  joinID,
  semanticIDFromSeed,
  shortID,
} from "./connections";
import { newDB } from "./knowledge";
import { findTag } from "./nostrEvents";
import { createRootAnchor } from "./rootAnchor";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { newRelations } from "./relationFactory";

export type WalkContext = {
  knowledgeDBs: KnowledgeDBs;
  publicKey: PublicKey;
  affectedRoots: ImmutableSet<ID>;
  updated?: number;
};

function walkUpsertRelation(
  ctx: WalkContext,
  relation: Relations
): WalkContext {
  const db = ctx.knowledgeDBs.get(ctx.publicKey, newDB());
  const normalizedRelation = ensureRelationNativeFields(
    ctx.knowledgeDBs,
    relation
  );
  return {
    ...ctx,
    knowledgeDBs: ctx.knowledgeDBs.set(ctx.publicKey, {
      ...db,
      relations: db.relations.set(
        shortID(normalizedRelation.id),
        normalizedRelation
      ),
    }),
    affectedRoots: ctx.affectedRoots.add(normalizedRelation.root),
  };
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  semanticContext: List<ID>,
  root: ID,
  parent?: LongID
): [WalkContext, ID, LongID] {
  const node = {
    id: createSemanticID(
      treeNode.text,
      treeNode.semanticID ??
        (treeNode.uuid ? semanticIDFromSeed(treeNode.uuid) : undefined)
    ),
    text: treeNode.text,
    textHash: hashText(treeNode.text),
  };
  const baseRelation = treeNode.uuid
    ? {
        ...newRelations(node.id, semanticContext, ctx.publicKey, root),
        id: joinID(ctx.publicKey, treeNode.uuid),
      }
    : newRelations(node.id, semanticContext, ctx.publicKey, root);
  const relationBaseWithFields: Relations = {
    ...baseRelation,
    text: node.text,
    textHash: node.textHash ?? hashText(node.text),
    parent,
    anchor: parent
      ? undefined
      : treeNode.anchor ?? createRootAnchor(semanticContext),
    systemRole: parent ? undefined : treeNode.systemRole,
    userPublicKey: treeNode.userPublicKey,
  };

  const childSemanticContext = semanticContext.push(
    relationBaseWithFields.textHash
  );
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childItems] = visibleChildren.reduce(
    ([accCtx, accItems], childNode) => {
      if (childNode.linkHref) {
        const parts = childNode.linkHref.split(":");
        const relationID = parts[0] as LongID;
        const item: RelationItem = {
          id: createConcreteRefId(relationID),
          relevance: childNode.relevance,
          argument: childNode.argument,
          linkText: childNode.text,
        };
        return [accCtx, [...accItems, item]] as [WalkContext, RelationItem[]];
      }
      const [afterChild, , materializedRelationID] = materializeTreeNode(
        accCtx,
        childNode,
        childSemanticContext,
        root,
        relationBaseWithFields.id
      );
      const item: RelationItem = {
        id: materializedRelationID,
        relevance: childNode.relevance,
        argument: childNode.argument,
      };
      return [afterChild, [...accItems, item]];
    },
    [ctx, [] as RelationItem[]] as [WalkContext, RelationItem[]]
  );

  const relation: Relations = {
    ...relationBaseWithFields,
    items: List(childItems),
    ...(treeNode.basedOn
      ? {
          basedOn: (treeNode.basedOn.includes("_")
            ? treeNode.basedOn
            : joinID(withVisible.publicKey, treeNode.basedOn)) as LongID,
        }
      : {}),
    ...(withVisible.updated !== undefined
      ? { updated: withVisible.updated }
      : {}),
  };
  return [
    walkUpsertRelation(withVisible, relation),
    relation.textHash,
    relation.id,
  ];
}

export function createNodesFromMarkdownTrees(
  ctx: WalkContext,
  trees: MarkdownTreeNode[],
  semanticContext: List<ID> = List<ID>()
): [WalkContext, topSemanticIDs: ID[], topRelationIDs: LongID[]] {
  return trees
    .filter((treeNode) => !treeNode.hidden)
    .reduce(
      ([accCtx, accTopSemanticIDs, accTopRelationIDs], treeNode) => {
        const rootUuid = treeNode.uuid ?? v4();
        const treeWithUuid = treeNode.uuid
          ? treeNode
          : { ...treeNode, uuid: rootUuid };
        const treeSemanticContext =
          treeNode.anchor?.snapshotContext ?? semanticContext;
        const [nextCtx, topSemanticID, topRelationID] = materializeTreeNode(
          accCtx,
          treeWithUuid,
          treeSemanticContext,
          rootUuid as ID
        );
        return [
          nextCtx,
          [...accTopSemanticIDs, topSemanticID],
          [...accTopRelationIDs, topRelationID],
        ];
      },
      [ctx, [] as ID[], [] as LongID[]] as [WalkContext, ID[], LongID[]]
    );
}

export function parseDocumentEvent(
  event: UnsignedEvent
): Map<string, Relations> {
  const dTagValue = findTag(event, "d");
  if (!dTagValue) {
    return Map();
  }

  const author = event.pubkey as PublicKey;
  const trees = parseMarkdownHierarchy(event.content);
  const ctx: WalkContext = {
    knowledgeDBs: Map<PublicKey, KnowledgeData>(),
    publicKey: author,
    affectedRoots: ImmutableSet<ID>(),
    updated: Number(findTag(event, "ms")) || event.created_at * 1000,
  };
  const [result] = createNodesFromMarkdownTrees(ctx, trees);
  const db = result.knowledgeDBs.get(author);
  return db?.relations ?? Map<string, Relations>();
}
