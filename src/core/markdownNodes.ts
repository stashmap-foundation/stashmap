/* eslint-disable functional/immutable-data */
import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { ensureNodeNativeFields } from "./connections";
import { newDB } from "./knowledge";
import { MarkdownTreeNode } from "./markdownTree";
import { newGraphNode } from "./nodeFactory";
import { pathOf, rowIdOf, rowKey } from "./nodeRef";

export type WalkContext = {
  knowledgeDBs: KnowledgeDBs;
  sourceId: SourceId;
  affectedDocuments: ImmutableSet<string>;
  updated?: number;
};

function walkUpsertNode(ctx: WalkContext, node: GraphNode): WalkContext {
  const db = ctx.knowledgeDBs.get(ctx.sourceId, newDB());
  const normalizedNode = ensureNodeNativeFields(db, node);
  return {
    ...ctx,
    knowledgeDBs: ctx.knowledgeDBs.set(ctx.sourceId, {
      ...db,
      nodes: db.nodes.set(normalizedNode.id, normalizedNode),
    }),
    affectedDocuments: ctx.affectedDocuments.add(pathOf(normalizedNode.id)),
  };
}

function assertUnusedNodeId(ctx: WalkContext, id: ID): void {
  if (ctx.knowledgeDBs.get(ctx.sourceId)?.nodes.has(id)) {
    throw new Error(`${pathOf(id)} contains id:${rowIdOf(id)} more than once`);
  }
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  path: string,
  root: ID | undefined,
  parent: ID | undefined
): [WalkContext, GraphNode] {
  const id = rowKey(path, treeNode.uuid ?? v4());
  const baseNode = newGraphNode(treeNode.spans, {
    id,
    root: root ?? id,
    relevance: treeNode.relevance,
    argument: treeNode.argument,
  });
  const nodeBaseWithFields: GraphNode = {
    ...baseNode,
    parent,
    systemRole: parent ? undefined : treeNode.systemRole,
    ...(treeNode.blockKind !== undefined && { blockKind: treeNode.blockKind }),
    ...(treeNode.headingLevel !== undefined && {
      headingLevel: treeNode.headingLevel,
    }),
    ...(treeNode.listOrdered !== undefined && {
      listOrdered: treeNode.listOrdered,
    }),
    ...(treeNode.listStart !== undefined && { listStart: treeNode.listStart }),
    ...(treeNode.extraAttrs !== undefined && {
      extraAttrs: treeNode.extraAttrs,
    }),
  };

  assertUnusedNodeId(ctx, id);
  const [withVisible, childIDs] = treeNode.children.reduce(
    ([accCtx, accChildren], childNode) => {
      const [afterChild, materializedChild] = materializeTreeNode(
        accCtx,
        childNode,
        path,
        nodeBaseWithFields.root,
        nodeBaseWithFields.id
      );
      return [afterChild, [...accChildren, materializedChild.id]];
    },
    [walkUpsertNode(ctx, nodeBaseWithFields), [] as ID[]] as [WalkContext, ID[]]
  );

  const node: GraphNode = {
    ...nodeBaseWithFields,
    children: List(childIDs),
    ...(withVisible.updated !== undefined
      ? { updated: withVisible.updated }
      : {}),
  };
  return [walkUpsertNode(withVisible, node), node];
}

export type MaterializeOptions = {
  context?: WalkContext;
  updatedMs?: number;
};

export type MaterializeResult = {
  context: WalkContext;
  topNodeIds: ID[];
};

export function materializeTree(
  trees: MarkdownTreeNode[],
  sourceId: SourceId,
  path: string,
  options: MaterializeOptions = {}
): MaterializeResult {
  const baseContext: WalkContext = options.context ?? {
    knowledgeDBs: ImmutableMap<SourceId, KnowledgeData>(),
    sourceId,
    affectedDocuments: ImmutableSet<string>(),
  };
  const ctx: WalkContext =
    options.updatedMs !== undefined
      ? { ...baseContext, updated: options.updatedMs }
      : baseContext;
  return trees.reduce<MaterializeResult>(
    (acc, treeNode) => {
      const [nextCtx, topNode] = materializeTreeNode(
        acc.context,
        treeNode,
        path,
        undefined,
        undefined
      );
      return {
        context: nextCtx,
        topNodeIds: [...acc.topNodeIds, topNode.id],
      };
    },
    { context: ctx, topNodeIds: [] }
  );
}
