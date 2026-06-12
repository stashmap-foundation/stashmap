/* eslint-disable functional/immutable-data */
import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { ensureNodeNativeFields } from "./connections";
import { newDB } from "./knowledge";
import { MarkdownTreeNode } from "./markdownTree";
import { newGraphNode } from "./nodeFactory";
import { fileLinkSpan, linkSpan, nodeText } from "./nodeSpans";

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

function singleBlockLinkSpan(spans: InlineSpan[]): InlineSpan | undefined {
  if (spans.length !== 1) return undefined;
  const span = spans[0];
  if (span.kind === "link" || span.kind === "fileLink") return span;
  return undefined;
}

type IdMaterializationMode = "default" | "preserve-explicit";

function usesExactTreeNodeId(
  mode: IdMaterializationMode,
  treeNode: MarkdownTreeNode
): boolean {
  return mode === "preserve-explicit" && treeNode.uuid !== undefined;
}

function newMarkdownGraphNode(
  ctx: WalkContext,
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
    ctx,
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
  };

  const [withVisible, childIDs] = treeNode.children.reduce(
    ([accCtx, accChildren], childNode) => {
      const blockLink = singleBlockLinkSpan(childNode.spans);
      if (blockLink && blockLink.kind === "link") {
        assertUnusedTreeNodeId(accCtx, childNode);
        const refNode = newMarkdownGraphNode(
          ctx,
          childNode,
          [linkSpan(blockLink.targetID, blockLink.text)],
          {
            root,
            parent: nodeBaseWithFields.id,
            relevance: childNode.relevance,
            argument: childNode.argument,
          },
          mode
        );
        return [
          walkUpsertNode(accCtx, refNode),
          [...accChildren, refNode.id],
        ] as [WalkContext, ID[]];
      }
      if (blockLink && blockLink.kind === "fileLink") {
        assertUnusedTreeNodeId(accCtx, childNode);
        const fileNode = newMarkdownGraphNode(
          ctx,
          childNode,
          [fileLinkSpan(blockLink.path, blockLink.text)],
          {
            root,
            parent: nodeBaseWithFields.id,
            relevance: childNode.relevance,
            argument: childNode.argument,
          },
          mode
        );
        return [
          walkUpsertNode(accCtx, fileNode),
          [...accChildren, fileNode.id],
        ] as [WalkContext, ID[]];
      }
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
