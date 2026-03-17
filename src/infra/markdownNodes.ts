/* eslint-disable functional/immutable-data */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import { ensureNodeNativeFields } from "../graph/queries";
import { createRootAnchor, joinID, shortID } from "../graph/context";
import { newDB } from "../graph/types";
import { findTag } from "./nostrEvents";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { newRefNode, newNode } from "../graph/nodeFactory";

export type WalkContext = {
  knowledgeDBs: KnowledgeDBs;
  publicKey: PublicKey;
  affectedRoots: ImmutableSet<ID>;
  updated?: number;
};

function walkUpsertNode(ctx: WalkContext, node: GraphNode): WalkContext {
  const db = ctx.knowledgeDBs.get(ctx.publicKey, newDB());
  const normalizedNode = ensureNodeNativeFields(ctx.knowledgeDBs, node);
  return {
    ...ctx,
    knowledgeDBs: ctx.knowledgeDBs.set(ctx.publicKey, {
      ...db,
      nodes: db.nodes.set(shortID(normalizedNode.id), normalizedNode),
    }),
    affectedRoots: ctx.affectedRoots.add(normalizedNode.root),
  };
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  semanticContext: List<ID>,
  root: LongID,
  parent?: LongID
): [WalkContext, ID, GraphNode] {
  const baseNode = treeNode.uuid
    ? {
        ...newNode(treeNode.text, semanticContext, ctx.publicKey, root),
        id: joinID(ctx.publicKey, treeNode.uuid),
      }
    : newNode(treeNode.text, semanticContext, ctx.publicKey, root);
  const nodeBaseWithFields: GraphNode = {
    ...baseNode,
    parent,
    anchor: parent
      ? undefined
      : treeNode.anchor ?? createRootAnchor(semanticContext),
    systemRole: parent ? undefined : treeNode.systemRole,
    userPublicKey: treeNode.userPublicKey,
    snapshotDTag: parent ? undefined : treeNode.snapshotDTag,
  };

  const childSemanticContext = semanticContext.push(
    nodeBaseWithFields.text as ID
  );
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childIDs] = visibleChildren.reduce(
    ([accCtx, accChildren], childNode) => {
      if (childNode.linkHref) {
        const refNode = newRefNode(
          ctx.publicKey,
          root,
          childNode.linkHref as LongID,
          nodeBaseWithFields.id,
          childNode.relevance,
          childNode.argument,
          childNode.text,
          childNode.text
        );
        return [
          walkUpsertNode(accCtx, refNode),
          [...accChildren, refNode.id],
        ] as [WalkContext, ID[]];
      }
      const [afterChild, , materializedChild] = materializeTreeNode(
        accCtx,
        childNode,
        childSemanticContext,
        root,
        nodeBaseWithFields.id
      );
      const childWithParentMetadata: GraphNode = {
        ...materializedChild,
        relevance: childNode.relevance,
        argument: childNode.argument,
      };
      return [
        walkUpsertNode(afterChild, childWithParentMetadata),
        [...accChildren, childWithParentMetadata.id],
      ];
    },
    [ctx, [] as ID[]] as [WalkContext, ID[]]
  );

  const node: GraphNode = {
    ...nodeBaseWithFields,
    children: List(childIDs),
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
  return [walkUpsertNode(withVisible, node), node.text as ID, node];
}

export function createNodesFromMarkdownTrees(
  ctx: WalkContext,
  trees: MarkdownTreeNode[],
  semanticContext: List<ID> = List<ID>()
): [WalkContext, topSemanticIDs: ID[], topNodeIDs: LongID[]] {
  return trees
    .filter((treeNode) => !treeNode.hidden)
    .reduce(
      ([accCtx, accTopSemanticIDs, accTopNodeIDs], treeNode) => {
        const rootUuid = treeNode.uuid ?? v4();
        const rootNodeID = joinID(ctx.publicKey, rootUuid);
        const treeWithUuid = treeNode.uuid
          ? treeNode
          : { ...treeNode, uuid: rootUuid };
        const treeSemanticContext =
          treeNode.anchor?.snapshotContext ?? semanticContext;
        const [nextCtx, topSemanticID, topNodeID] = materializeTreeNode(
          accCtx,
          treeWithUuid,
          treeSemanticContext,
          rootNodeID
        );
        return [
          nextCtx,
          [...accTopSemanticIDs, topSemanticID],
          [...accTopNodeIDs, topNodeID.id as LongID],
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
