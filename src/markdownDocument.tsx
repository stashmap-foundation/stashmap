/* eslint-disable functional/immutable-data */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import {
  shortID,
  hashText,
  joinID,
  createSemanticID,
  semanticIDFromSeed,
  isConcreteRefId,
  parseConcreteRefId,
  createConcreteRefId,
  ensureRelationNativeFields,
  getConcreteRefTargetRelation,
  getRelationContext,
  getRelationSemanticID,
} from "./connections";
import { getTextForSemanticID } from "./semanticProjection";
import {
  ViewPath,
  isRoot,
  getRowIDFromView,
  getDisplayTextForView,
  getCurrentEdgeForView,
  getRelationForView,
  getContext,
  newRelations,
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceRow";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { findTag } from "./nostrEvents";
import { getNodesInTree } from "./treeTraversal";
import { newDB } from "./knowledge";
import { createRootAnchor } from "./rootAnchor";
import { resolveSemanticRelationInCurrentTree } from "./semanticNavigation";

export type { MarkdownTreeNode } from "./markdownTree";
export { parseMarkdownHierarchy } from "./markdownTree";

function formatCrefText(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  refID: LongID | ID
): string | undefined {
  const parsed = parseConcreteRefId(refID);
  if (!parsed) {
    return undefined;
  }
  const ref = buildOutgoingReference(refID as LongID, knowledgeDBs, author);
  if (!ref) {
    return undefined;
  }
  const targetRelation = getConcreteRefTargetRelation(
    knowledgeDBs,
    refID,
    author
  );
  const href = targetRelation ? `${targetRelation.id}` : `${parsed.relationID}`;
  return `[${ref.text}](#${href})`;
}

type SerializeResult = {
  lines: string[];
  nodeHashes: ImmutableSet<string>;
  semanticIDs: ImmutableSet<string>;
  relationUUIDs: ImmutableSet<string>;
};

function getOwnRelationForDocumentSerialization(
  data: Data,
  path: ViewPath,
  stack: ID[],
  author: PublicKey,
  itemID: LongID | ID,
  semanticContext: List<ID>,
  rootRelation: Relations,
  isRootNode: boolean
): Relations | undefined {
  const directRelation = getRelationForView(data, path, stack);
  if (directRelation) {
    return directRelation;
  }
  return resolveSemanticRelationInCurrentTree(
    data.knowledgeDBs,
    author,
    itemID,
    semanticContext,
    rootRelation.id,
    isRootNode,
    rootRelation.root
  );
}

function getSerializedRelationText(
  data: Data,
  relation: Relations,
  semanticID: LongID | ID
): { text: string; textHash: ID } {
  if (relation.text !== "") {
    return {
      text: relation.text,
      textHash: relation.textHash,
    };
  }

  const fallbackText =
    getTextForSemanticID(data.knowledgeDBs, semanticID, relation.author) ??
    shortID(semanticID as ID);
  return {
    text: fallbackText,
    textHash: hashText(fallbackText),
  };
}

function buildRootPath(rootRelation: Relations): ViewPath {
  return [0, rootRelation.id];
}

function serializeTree(data: Data, rootRelation: Relations): SerializeResult {
  const author = data.user.publicKey;
  const rootPath = buildRootPath(rootRelation);
  const stack = [getRelationSemanticID(rootRelation)];
  const { paths } = getNodesInTree(
    data,
    rootPath,
    stack,
    List<ViewPath>(),
    rootRelation.id,
    author,
    undefined,
    { isMarkdownExport: true }
  );
  return paths.reduce<SerializeResult>(
    (acc, path) => {
      const depth = path.length - 3;
      const [itemID] = getRowIDFromView(data, path);
      const indent = "  ".repeat(depth);
      const semanticContext = getContext(data, path, stack);
      const item = getCurrentEdgeForView(data, path);

      if (isConcreteRefId(itemID)) {
        const parsed = parseConcreteRefId(itemID);
        const crefText = formatCrefText(data.knowledgeDBs, author, itemID);
        if (!crefText || !parsed) return acc;
        const targetRelation = getConcreteRefTargetRelation(
          data.knowledgeDBs,
          itemID,
          author
        );
        const crefRelationUUID = shortID(
          (targetRelation?.id || parsed.relationID) as ID
        );
        const crefNodeHashes = targetRelation
          ? acc.nodeHashes.add(hashText(targetRelation.text))
          : acc.nodeHashes;
        const crefAttrs = formatNodeAttrs("", item?.relevance, item?.argument);
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${crefText}${crefAttrs}`],
          nodeHashes: crefNodeHashes,
          semanticIDs: targetRelation
            ? acc.semanticIDs.add(getRelationSemanticID(targetRelation))
            : acc.semanticIDs,
          relationUUIDs: acc.relationUUIDs.add(crefRelationUUID),
        };
      }

      const ownRelation = getOwnRelationForDocumentSerialization(
        data,
        path,
        stack,
        author,
        itemID,
        semanticContext,
        rootRelation,
        isRoot(path)
      );
      const serializedRelation = ownRelation
        ? getSerializedRelationText(
            data,
            ownRelation,
            getRelationSemanticID(ownRelation)
          )
        : undefined;
      const serializedSemanticID = ownRelation
        ? getRelationSemanticID(ownRelation)
        : (shortID(itemID as ID) as ID);
      const text =
        serializedRelation?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();

      const line = `${indent}- ${text}${formatNodeAttrs(
        uuid,
        item?.relevance,
        item?.argument,
        {
          basedOn: ownRelation?.basedOn,
          semanticID: serializedSemanticID,
          userPublicKey: ownRelation?.userPublicKey,
        }
      )}`;
      return {
        lines: [...acc.lines, line],
        nodeHashes: acc.nodeHashes.add(
          serializedRelation?.textHash ?? hashText(text)
        ),
        semanticIDs: acc.semanticIDs.add(serializedSemanticID),
        relationUUIDs: acc.relationUUIDs.add(uuid),
      };
    },
    {
      lines: [],
      nodeHashes: ImmutableSet<string>(),
      semanticIDs: ImmutableSet<string>(),
      relationUUIDs: ImmutableSet<string>(),
    }
  );
}

export function treeToMarkdown(data: Data, rootRelation: Relations): string {
  const rootContext = getRelationContext(data.knowledgeDBs, rootRelation);
  const rootSemanticID = getRelationSemanticID(rootRelation);
  const { text: rootText } = getSerializedRelationText(
    data,
    rootRelation,
    rootSemanticID
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootSemanticID,
    rootRelation.anchor ?? createRootAnchor(rootContext),
    rootRelation.systemRole
  );
  const { lines } = serializeTree(data, rootRelation);
  return `${[rootLine, ...lines].join("\n")}\n`;
}

export function buildDocumentEvent(
  data: Data,
  rootRelation: Relations
): UnsignedEvent {
  const author = data.user.publicKey;
  const rootContext = getRelationContext(data.knowledgeDBs, rootRelation);
  const rootSemanticID = getRelationSemanticID(rootRelation);
  const { text: rootText, textHash: rootTextHash } = getSerializedRelationText(
    data,
    rootRelation,
    rootSemanticID
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootSemanticID,
    rootRelation.anchor ?? createRootAnchor(rootContext),
    rootRelation.systemRole
  );
  const result = serializeTree(data, rootRelation);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const nTags = result.nodeHashes
    .add(rootTextHash)
    .union(result.semanticIDs.add(rootSemanticID))
    .toArray()
    .map((value) => ["n", value]);
  const rTags = result.relationUUIDs
    .add(rootUuid)
    .toArray()
    .map((u) => ["r", u]);
  const systemRoleTags = rootRelation.systemRole
    ? ([["s", rootRelation.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...nTags, ...rTags, ...systemRoleTags, msTag()],
    content,
  };
}

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
