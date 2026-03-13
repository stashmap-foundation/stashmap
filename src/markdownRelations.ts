/* eslint-disable functional/immutable-data */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import { ensureRelationNativeFields, joinID, shortID } from "./connections";
import { newDB } from "./knowledge";
import { findTag } from "./nostrEvents";
import { createRootAnchor } from "./rootAnchor";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { newRefNode, newRelations } from "./relationFactory";

export type WalkContext = {
  knowledgeDBs: KnowledgeDBs;
  publicKey: PublicKey;
  affectedRoots: ImmutableSet<ID>;
  updated?: number;
};

function walkUpsertRelation(
  ctx: WalkContext,
  relation: GraphNode
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
      nodes: db.nodes.set(shortID(normalizedRelation.id), normalizedRelation),
    }),
    affectedRoots: ctx.affectedRoots.add(normalizedRelation.root),
  };
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  semanticContext: List<ID>,
  root: LongID,
  parent?: LongID
): [WalkContext, ID, GraphNode] {
  const baseRelation = treeNode.uuid
    ? {
        ...newRelations(treeNode.text, semanticContext, ctx.publicKey, root),
        id: joinID(ctx.publicKey, treeNode.uuid),
      }
    : newRelations(treeNode.text, semanticContext, ctx.publicKey, root);
  const relationBaseWithFields: GraphNode = {
    ...baseRelation,
    parent,
    anchor: parent
      ? undefined
      : treeNode.anchor ?? createRootAnchor(semanticContext),
    systemRole: parent ? undefined : treeNode.systemRole,
    userPublicKey: treeNode.userPublicKey,
  };

  const childSemanticContext = semanticContext.push(
    relationBaseWithFields.text as ID
  );
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childNodes] = visibleChildren.reduce(
    ([accCtx, accChildren], childNode) => {
      if (childNode.linkHref) {
        const refNode = newRefNode(
          ctx.publicKey,
          root,
          childNode.linkHref as LongID,
          relationBaseWithFields.id,
          childNode.relevance,
          childNode.argument,
          childNode.text,
          childNode.text
        );
        return [accCtx, [...accChildren, refNode]] as [
          WalkContext,
          GraphNode[]
        ];
      }
      const [afterChild, , materializedChild] = materializeTreeNode(
        accCtx,
        childNode,
        childSemanticContext,
        root,
        relationBaseWithFields.id
      );
      const childWithParentMetadata: GraphNode = {
        ...materializedChild,
        relevance: childNode.relevance,
        argument: childNode.argument,
      };
      return [
        walkUpsertRelation(afterChild, childWithParentMetadata),
        [...accChildren, childWithParentMetadata],
      ];
    },
    [ctx, [] as GraphNode[]] as [WalkContext, GraphNode[]]
  );

  const relation: GraphNode = {
    ...relationBaseWithFields,
    children: List(childNodes),
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
    relation.text as ID,
    relation,
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
        const rootRelationID = joinID(ctx.publicKey, rootUuid);
        const treeWithUuid = treeNode.uuid
          ? treeNode
          : { ...treeNode, uuid: rootUuid };
        const treeSemanticContext =
          treeNode.anchor?.snapshotContext ?? semanticContext;
        const [nextCtx, topSemanticID, topRelationID] = materializeTreeNode(
          accCtx,
          treeWithUuid,
          treeSemanticContext,
          rootRelationID
        );
        return [
          nextCtx,
          [...accTopSemanticIDs, topSemanticID],
          [...accTopRelationIDs, topRelationID.id as LongID],
        ];
      },
      [ctx, [] as ID[], [] as LongID[]] as [WalkContext, ID[], LongID[]]
    );
}

export function parseDocumentEvent(
  event: UnsignedEvent
): Map<string, GraphNode> {
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
  return db?.nodes ?? Map<string, GraphNode>();
}
