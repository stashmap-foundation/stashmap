/* eslint-disable functional/immutable-data */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import { ensureNodeNativeFields, joinID, shortID } from "./connections";
import { newDB } from "./knowledge";
import { findTag } from "./nostrEvents";
import { createRootAnchor } from "./rootAnchor";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { newRefNode, newNode } from "./nodeFactory";
import { extractImportedFrontMatter } from "./markdownFrontMatter";
import { dropLeadingYamlEchoRoots } from "./markdownImport";

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
    frontMatter: parent ? undefined : treeNode.frontMatter,
    filePath: parent ? undefined : treeNode.filePath,
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

export function parseDocumentContent(params: {
  content: string;
  author: PublicKey;
  filePath?: string;
  updatedMs?: number;
}): Map<string, GraphNode> {
  const { content, author, filePath, updatedMs } = params;
  const { body, frontMatter } = extractImportedFrontMatter(content);
  const trees = dropLeadingYamlEchoRoots(
    parseMarkdownHierarchy(body),
    frontMatter
  ).map((tree, index) =>
    index === 0
      ? {
          ...tree,
          ...(frontMatter && { frontMatter }),
          ...(filePath && { filePath }),
        }
      : tree
  );
  const ctx: WalkContext = {
    knowledgeDBs: Map<PublicKey, KnowledgeData>(),
    publicKey: author,
    affectedRoots: ImmutableSet<ID>(),
    updated: updatedMs ?? Date.now(),
  };
  const [result] = createNodesFromMarkdownTrees(ctx, trees);
  const db = result.knowledgeDBs.get(author);
  return db?.nodes ?? Map<string, GraphNode>();
}

export function parseDocumentEvent(
  event: UnsignedEvent,
  options: { filePath?: string } = {}
): Map<string, GraphNode> {
  return parseDocumentContent({
    content: event.content,
    author: event.pubkey as PublicKey,
    filePath: options.filePath,
    updatedMs: Number(findTag(event, "ms")) || event.created_at * 1000,
  });
}
