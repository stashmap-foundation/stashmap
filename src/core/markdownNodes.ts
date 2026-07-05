/* eslint-disable functional/immutable-data */
import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { ensureNodeNativeFields } from "./connections";
import { newDB } from "./knowledge";
import { MarkdownTreeNode } from "./markdownTree";
import { newGraphNode } from "./nodeFactory";
import { nodeText } from "./nodeSpans";

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
    affectedDocuments: normalizedNode.docId
      ? ctx.affectedDocuments.add(normalizedNode.docId)
      : ctx.affectedDocuments,
  };
}

function assertUnusedTreeNodeId(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode
): void {
  if (!treeNode.uuid) {
    return;
  }
  const existing = ctx.knowledgeDBs.get(ctx.sourceId)?.nodes.get(treeNode.uuid);
  if (existing) {
    throw new Error(`Workspace contains duplicate node ids: ${treeNode.uuid}`);
  }
}

type IdMaterializationMode = "default" | "preserve-explicit";

function usesExactTreeNodeId(
  mode: IdMaterializationMode,
  treeNode: MarkdownTreeNode
): boolean {
  return mode === "preserve-explicit" && treeNode.uuid !== undefined;
}

function newMarkdownGraphNode(
  treeNode: MarkdownTreeNode,
  spans: InlineSpan[],
  options: Parameters<typeof newGraphNode>[1],
  mode: IdMaterializationMode
): GraphNode {
  const node = newGraphNode(spans, {
    ...options,
    uuid: treeNode.uuid,
  });
  return usesExactTreeNodeId(mode, treeNode) && treeNode.uuid
    ? { ...node, id: treeNode.uuid }
    : node;
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  root: ID,
  parent: ID | undefined,
  mode: IdMaterializationMode
): [WalkContext, ID, GraphNode] {
  const baseNode = newMarkdownGraphNode(
    treeNode,
    treeNode.spans,
    {
      root,
      relevance: treeNode.relevance,
      argument: treeNode.argument,
    },
    mode
  );
  const nodeBaseWithFields: GraphNode = {
    ...baseNode,
    spans: treeNode.spans,
    parent,
    docId: parent ? undefined : treeNode.docId,
    systemRole: parent ? undefined : treeNode.systemRole,
    snapshotId: treeNode.snapshotId,
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

  const [withVisible, childIDs] = treeNode.children.reduce(
    ([accCtx, accChildren], childNode) => {
      // Link rows take the ordinary recursive path: they are nodes like
      // any other and carry children (idea.md, Entity nodes). The tree
      // parser already normalizes them to a single link span, so no
      // special materialization is needed — the old special case here
      // silently dropped everything nested under a link row.
      const [afterChild, , materializedChild] = materializeTreeNode(
        accCtx,
        childNode,
        root,
        nodeBaseWithFields.id,
        mode
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

  assertUnusedTreeNodeId(withVisible, treeNode);
  const node: GraphNode = {
    ...nodeBaseWithFields,
    children: List(childIDs),
    ...(treeNode.basedOn ? { basedOn: treeNode.basedOn as ID } : {}),
    ...(withVisible.updated !== undefined
      ? { updated: withVisible.updated }
      : {}),
  };
  return [walkUpsertNode(withVisible, node), nodeText(node) as ID, node];
}

export type MaterializeOptions = {
  context?: WalkContext;
  updatedMs?: number;
};

export type MaterializeResult = {
  context: WalkContext;
  topSemanticIds: ID[];
  topNodeIds: ID[];
};

function materializeTreeWithMode(
  trees: MarkdownTreeNode[],
  sourceId: SourceId,
  options: MaterializeOptions,
  mode: IdMaterializationMode
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
      const hasExplicitRootId = usesExactTreeNodeId(mode, treeNode);
      const rootUuid = treeNode.uuid ?? v4();
      const rootNodeID = rootUuid as ID;
      const treeWithUuid = hasExplicitRootId
        ? treeNode
        : { ...treeNode, uuid: rootUuid };
      const [nextCtx, topSemanticID, topNodeID] = materializeTreeNode(
        acc.context,
        treeWithUuid,
        rootNodeID,
        undefined,
        mode
      );
      return {
        context: nextCtx,
        topSemanticIds: [...acc.topSemanticIds, topSemanticID],
        topNodeIds: [...acc.topNodeIds, topNodeID.id as ID],
      };
    },
    { context: ctx, topSemanticIds: [], topNodeIds: [] }
  );
}

export function materializeTree(
  trees: MarkdownTreeNode[],
  sourceId: SourceId,
  options: MaterializeOptions = {}
): MaterializeResult {
  return materializeTreeWithMode(trees, sourceId, options, "default");
}

export function materializeTreePreservingExplicitIds(
  trees: MarkdownTreeNode[],
  sourceId: SourceId,
  options: MaterializeOptions
): MaterializeResult {
  return materializeTreeWithMode(trees, sourceId, options, "preserve-explicit");
}
