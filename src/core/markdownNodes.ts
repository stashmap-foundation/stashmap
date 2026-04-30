/* eslint-disable functional/immutable-data */
import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { ensureNodeNativeFields, joinID, shortID } from "./connections";
import { newDB } from "./knowledge";
import { createRootAnchor } from "./rootAnchor";
import { MarkdownTreeNode } from "./markdownTree";
import { newRefNode, newNode, newFileLinkNode } from "./nodeFactory";
import { nodeText, spansText } from "./nodeSpans";

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

function singleBlockLinkSpan(spans: InlineSpan[]): InlineSpan | undefined {
  if (spans.length !== 1) return undefined;
  const span = spans[0];
  if (span.kind === "link" || span.kind === "fileLink") return span;
  return undefined;
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  semanticContext: List<ID>,
  root: LongID,
  parent?: LongID
): [WalkContext, ID, GraphNode] {
  const treeText = spansText(treeNode.spans);
  const baseNode = treeNode.uuid
    ? {
        ...newNode(treeText, semanticContext, ctx.publicKey, root),
        id: joinID(ctx.publicKey, treeNode.uuid),
      }
    : newNode(treeText, semanticContext, ctx.publicKey, root);
  const nodeBaseWithFields: GraphNode = {
    ...baseNode,
    spans: treeNode.spans,
    parent,
    docId: parent ? undefined : treeNode.docId,
    anchor: parent
      ? undefined
      : treeNode.anchor ?? createRootAnchor(semanticContext),
    systemRole: parent ? undefined : treeNode.systemRole,
    userPublicKey: treeNode.userPublicKey,
    snapshotDTag: parent ? undefined : treeNode.snapshotDTag,
    ...(treeNode.blockKind !== undefined && { blockKind: treeNode.blockKind }),
    ...(treeNode.headingLevel !== undefined && {
      headingLevel: treeNode.headingLevel,
    }),
    ...(treeNode.listOrdered !== undefined && {
      listOrdered: treeNode.listOrdered,
    }),
    ...(treeNode.listStart !== undefined && { listStart: treeNode.listStart }),
  };

  const childSemanticContext = semanticContext.push(
    nodeText(nodeBaseWithFields) as ID
  );
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childIDs] = visibleChildren.reduce(
    ([accCtx, accChildren], childNode) => {
      const blockLink = singleBlockLinkSpan(childNode.spans);
      if (blockLink && blockLink.kind === "link") {
        const refNode = newRefNode(
          ctx.publicKey,
          root,
          blockLink.targetID,
          nodeBaseWithFields.id,
          childNode.relevance,
          childNode.argument,
          blockLink.text,
          blockLink.text
        );
        return [
          walkUpsertNode(accCtx, refNode),
          [...accChildren, refNode.id],
        ] as [WalkContext, ID[]];
      }
      if (blockLink && blockLink.kind === "fileLink") {
        const fileNode = newFileLinkNode(
          ctx.publicKey,
          root,
          blockLink.path,
          nodeBaseWithFields.id,
          childNode.relevance,
          childNode.argument,
          blockLink.text
        );
        return [
          walkUpsertNode(accCtx, fileNode),
          [...accChildren, fileNode.id],
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

  if (treeNode.uuid) {
    const existing = withVisible.knowledgeDBs
      .get(withVisible.publicKey)
      ?.nodes.get(treeNode.uuid);
    if (existing) {
      throw new Error(
        `Workspace contains duplicate node ids: ${treeNode.uuid}`
      );
    }
  }
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
  return [walkUpsertNode(withVisible, node), nodeText(node) as ID, node];
}

export type MaterializeOptions = {
  context?: WalkContext;
  updatedMs?: number;
  semanticContext?: List<ID>;
};

export type MaterializeResult = {
  context: WalkContext;
  topSemanticIds: ID[];
  topNodeIds: LongID[];
};

export function materializeTree(
  trees: MarkdownTreeNode[],
  author: PublicKey,
  options: MaterializeOptions = {}
): MaterializeResult {
  const baseContext: WalkContext = options.context ?? {
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    publicKey: author,
    affectedRoots: ImmutableSet<ID>(),
  };
  const ctx: WalkContext =
    options.updatedMs !== undefined
      ? { ...baseContext, updated: options.updatedMs }
      : baseContext;
  const semanticContext = options.semanticContext ?? List<ID>();
  return trees
    .filter((treeNode) => !treeNode.hidden)
    .reduce<MaterializeResult>(
      (acc, treeNode) => {
        const rootUuid = treeNode.uuid ?? v4();
        const rootNodeID = joinID(author, rootUuid);
        const treeWithUuid = treeNode.uuid
          ? treeNode
          : { ...treeNode, uuid: rootUuid };
        const treeSemanticContext =
          treeNode.anchor?.snapshotContext ?? semanticContext;
        const [nextCtx, topSemanticID, topNodeID] = materializeTreeNode(
          acc.context,
          treeWithUuid,
          treeSemanticContext,
          rootNodeID
        );
        return {
          context: nextCtx,
          topSemanticIds: [...acc.topSemanticIds, topSemanticID],
          topNodeIds: [...acc.topNodeIds, topNodeID.id as LongID],
        };
      },
      { context: ctx, topSemanticIds: [], topNodeIds: [] }
    );
}
