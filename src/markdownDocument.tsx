import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import MarkdownIt from "markdown-it";
import attrs from "markdown-it-attrs";
import Token from "markdown-it/lib/token";
import {
  shortID,
  hashText,
  joinID,
  newNode,
  isConcreteRefId,
  parseConcreteRefId,
  createConcreteRefId,
  findUniqueText,
  VERSIONS_NODE_ID,
  addRelationToRelations,
  moveRelations,
} from "./connections";
import {
  getNodeFromID,
  ViewPath,
  NodeIndex,
  getNodeIDFromView,
  getRelationForView,
  getDisplayTextForView,
  getRelationItemForView,
  getContext,
  viewPathToString,
  newRelations,
  getVersionsContext,
  getVersionsRelations,
  getRelationsForContext,
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceNode";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { findTag } from "./commons/useNostrQuery";
import { getNodesInTree } from "./treeTraversal";
import { newDB } from "./knowledge";

const markdown = new MarkdownIt();
markdown.use(attrs);

function extractInlineContent(inline: Token): {
  text: string;
  linkHref?: string;
} {
  if (!inline.children) {
    return { text: inline.content.trim() };
  }
  const text = inline.children
    .filter((c) => c.type === "text")
    .map((c) => c.content)
    .join("")
    .trim();
  const linkOpen = inline.children.find((c) => c.type === "link_open");
  const href = linkOpen?.attrGet("href");
  const linkHref =
    href && href.startsWith("#") ? href.slice(1) : undefined;
  return { text, linkHref };
}

function extractAttrs(token: Token): {
  uuid: string | undefined;
  relevance: Relevance;
  argument: Argument;
  hidden: boolean;
  basedOn: string | undefined;
} {
  if (!token.attrs) {
    return {
      uuid: undefined,
      relevance: undefined,
      argument: undefined,
      hidden: false,
      basedOn: undefined,
    };
  }
  const uuid = token.attrs.find(([, value]) => value === "")?.[0];
  const classAttr = token.attrGet("class") || "";
  const classes = classAttr.split(" ").filter(Boolean);
  const relevance = (
    ["relevant", "maybe_relevant", "little_relevant", "not_relevant"] as const
  ).find((r) => classes.includes(r));
  const argument = (["confirms", "contra"] as const).find((a) =>
    classes.includes(a)
  );
  const hidden = classes.includes("hidden");
  const basedOn = token.attrGet("basedOn") || undefined;
  return { uuid, relevance, argument, hidden, basedOn };
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
  uuid?: string;
  relevance?: Relevance;
  argument?: Argument;
  linkHref?: string;
  hidden?: boolean;
  basedOn?: string;
};

/* eslint-disable functional/immutable-data, functional/no-let, no-continue */
function appendNode(
  roots: MarkdownTreeNode[],
  parent: MarkdownTreeNode | undefined,
  node: MarkdownTreeNode
): void {
  if (parent) {
    parent.children.push(node);
    return;
  }
  roots.push(node);
}

function getLastDefinedListItem(
  listItemStack: Array<MarkdownTreeNode | undefined>
): MarkdownTreeNode | undefined {
  for (let i = listItemStack.length - 1; i >= 0; i -= 1) {
    const listItem = listItemStack[i];
    if (listItem) {
      return listItem;
    }
  }
  return undefined;
}

export function parseMarkdownHierarchy(
  markdownText: string
): MarkdownTreeNode[] {
  const tokens = markdown.parse(markdownText, {});
  const roots: MarkdownTreeNode[] = [];
  const headingStack: Array<{ level: number; node: MarkdownTreeNode }> = [];
  const listItemStack: Array<MarkdownTreeNode | undefined> = [];

  let pendingAttrs: {
    uuid: string | undefined;
    relevance: Relevance;
    argument: Argument;
    hidden: boolean;
    basedOn: string | undefined;
  } = {
    uuid: undefined,
    relevance: undefined,
    argument: undefined,
    hidden: false,
    basedOn: undefined,
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open") {
      const headingLevel = Number(token.tag.replace("h", ""));
      const inline = tokens[i + 1];
      if (!inline || inline.type !== "inline") {
        continue;
      }
      const { text } = extractInlineContent(inline);
      if (!text) {
        continue;
      }
      const { uuid, relevance, argument, hidden, basedOn } =
        extractAttrs(token);
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= headingLevel
      ) {
        headingStack.pop();
      }
      const parent =
        getLastDefinedListItem(listItemStack) ||
        headingStack[headingStack.length - 1]?.node;
      const node: MarkdownTreeNode = {
        text,
        children: [],
        uuid,
        relevance,
        argument,
        hidden,
        basedOn,
      };
      appendNode(roots, parent, node);
      headingStack.push({ level: headingLevel, node });
      continue;
    }

    if (token.type === "list_item_open") {
      pendingAttrs = extractAttrs(token);
      listItemStack.push(undefined);
      continue;
    }

    if (token.type === "list_item_close") {
      listItemStack.pop();
      continue;
    }

    if (token.type !== "paragraph_open") {
      continue;
    }

    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline") {
      continue;
    }
    const { text, linkHref } = extractInlineContent(inline);
    if (!text) {
      continue;
    }

    if (listItemStack.length > 0) {
      const currentItemIndex = listItemStack.length - 1;
      const currentListNode = listItemStack[currentItemIndex];
      if (!currentListNode) {
        const parent =
          getLastDefinedListItem(listItemStack.slice(0, -1)) ||
          headingStack[headingStack.length - 1]?.node;
        const { uuid, relevance, argument, hidden, basedOn } = pendingAttrs;
        const node: MarkdownTreeNode = {
          text,
          children: [],
          uuid,
          relevance,
          argument,
          linkHref,
          hidden,
          basedOn,
        };
        appendNode(roots, parent, node);
        listItemStack[currentItemIndex] = node;
        continue;
      }
      currentListNode.children.push({ text, children: [], linkHref });
      continue;
    }

    const paragraphNode: MarkdownTreeNode = { text, children: [] };
    appendNode(
      roots,
      headingStack[headingStack.length - 1]?.node,
      paragraphNode
    );
  }
  return roots;
}
/* eslint-enable functional/immutable-data, functional/no-let, no-continue */

function formatAttrs(
  uuid: string,
  relevance: Relevance,
  argument: Argument,
  options?: { hidden?: boolean; basedOn?: LongID }
): string {
  const parts: string[] = uuid ? [uuid] : [];
  if (relevance) {
    parts.push(`.${relevance}`);
  }
  if (argument) {
    parts.push(`.${argument}`);
  }
  if (options?.hidden) {
    parts.push(`.hidden`);
  }
  if (options?.basedOn) {
    parts.push(`basedOn="${options.basedOn}"`);
  }
  if (parts.length === 0) {
    return "";
  }
  return ` {${parts.join(" ")}}`;
}

function formatCrefText(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID,
  relevance: Relevance,
  argument: Argument
): string | undefined {
  const parsed = parseConcreteRefId(nodeID);
  if (!parsed) {
    return undefined;
  }
  const ref = buildOutgoingReference(
    nodeID as LongID,
    knowledgeDBs,
    author
  );
  if (!ref) {
    return undefined;
  }
  const relationUuid = shortID(parsed.relationID);
  const href = parsed.targetNode
    ? `${relationUuid}:${parsed.targetNode}`
    : relationUuid;
  const crefParts: string[] = [];
  if (relevance) {
    crefParts.push(`.${relevance}`);
  }
  if (argument) {
    crefParts.push(`.${argument}`);
  }
  const attrsStr =
    crefParts.length > 0 ? `{${crefParts.join(" ")}}` : "";
  return `[${ref.text}](#${href})${attrsStr}`;
}

type SerializeResult = {
  lines: string[];
  nodeHashes: ImmutableSet<string>;
  contextHashes: ImmutableSet<string>;
};

function serializeTree(
  data: Data,
  rootRelation: Relations
): SerializeResult {
  const author = data.user.publicKey;
  const rootPath = buildRootPath(rootRelation);
  const stack = [rootRelation.head];
  const { paths, virtualItems } = getNodesInTree(
    data, rootPath, stack, List<ViewPath>(), rootRelation.id,
    author, undefined, { isMarkdownExport: true }
  );
  return paths.reduce<SerializeResult>(
    (acc, path) => {
      const depth = path.length - 3;
      const [nodeID] = getNodeIDFromView(data, path);
      const indent = "  ".repeat(depth);
      const context = getContext(data, path, stack);
      const contextHash = context.size > 0
        ? hashText(context.join(":"))
        : undefined;
      const item = getRelationItemForView(data, path);
      const isVirtual = virtualItems.has(viewPathToString(path));

      if (isConcreteRefId(nodeID)) {
        const crefText = formatCrefText(
          data.knowledgeDBs, author, nodeID, item?.relevance, item?.argument
        );
        if (!crefText) return acc;
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${crefText}`],
          contextHashes: contextHash
            ? acc.contextHashes.add(contextHash)
            : acc.contextHashes,
        };
      }

      const nodeText = getNodeFromID(data.knowledgeDBs, nodeID, author)?.text;
      const text = nodeText ?? getDisplayTextForView(data, path, stack);
      const ownRelation = getRelationForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();

      const line = `${indent}- ${text}${formatAttrs(uuid, item?.relevance, item?.argument, { hidden: isVirtual, basedOn: ownRelation?.basedOn })}`;
      return {
        lines: [...acc.lines, line],
        nodeHashes: acc.nodeHashes.add(hashText(text)),
        contextHashes: contextHash
          ? acc.contextHashes.add(contextHash)
          : acc.contextHashes,
      };
    },
    {
      lines: [],
      nodeHashes: ImmutableSet<string>(),
      contextHashes: ImmutableSet<string>(),
    }
  );
}

function buildRootPath(rootRelation: Relations): ViewPath {
  return [
    0,
    { nodeID: rootRelation.head as LongID | ID, nodeIndex: 0 as NodeIndex },
  ] as ViewPath;
}

export function treeToMarkdown(
  data: Data,
  rootRelation: Relations
): string {
  const author = data.user.publicKey;
  const rootNode = getNodeFromID(data.knowledgeDBs, rootRelation.head, author);
  const rootText = rootNode?.text ?? rootRelation.head;
  const rootUuid = shortID(rootRelation.id);
  const rootLine = `# ${rootText} {${rootUuid}}`;
  const { lines } = serializeTree(data, rootRelation);
  return `${[rootLine, ...lines].join("\n")}\n`;
}

export function buildDocumentEvent(
  data: Data,
  rootRelation: Relations
): UnsignedEvent {
  const author = data.user.publicKey;
  const rootNode = getNodeFromID(data.knowledgeDBs, rootRelation.head, author);
  const rootText = rootNode?.text ?? rootRelation.head;
  const rootUuid = shortID(rootRelation.id);
  const rootLine = `# ${rootText} {${rootUuid}}`;
  const result = serializeTree(data, rootRelation);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const nTags = result.nodeHashes.add(hashText(rootText)).toArray().map((h) => ["n", h]);
  const cTags = result.contextHashes.toArray().map((h) => ["c", h]);

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...nTags, ...cTags, msTag()],
    content,
  };
}

export type WalkContext = {
  knowledgeDBs: KnowledgeDBs;
  publicKey: PublicKey;
  affectedRoots: ImmutableSet<ID>;
  updated?: number;
};

function walkUpsertNode(ctx: WalkContext, node: KnowNode): WalkContext {
  const db = ctx.knowledgeDBs.get(ctx.publicKey, newDB());
  return {
    ...ctx,
    knowledgeDBs: ctx.knowledgeDBs.set(ctx.publicKey, {
      ...db,
      nodes: db.nodes.set(shortID(node.id), node),
    }),
  };
}

function walkUpsertRelation(ctx: WalkContext, relation: Relations): WalkContext {
  const db = ctx.knowledgeDBs.get(ctx.publicKey, newDB());
  return {
    ...ctx,
    knowledgeDBs: ctx.knowledgeDBs.set(ctx.publicKey, {
      ...db,
      relations: db.relations.set(shortID(relation.id), relation),
    }),
    affectedRoots: ctx.affectedRoots.add(relation.root),
  };
}

export function createVersion(
  ctx: WalkContext,
  editedNodeID: ID,
  newText: string,
  editContext: List<ID>,
  root?: ID
): WalkContext {
  const isInsideVersions = editContext.last() === VERSIONS_NODE_ID;

  const [originalNodeID, context]: [ID, List<ID>] =
    isInsideVersions && editContext.size >= 2
      ? [
          editContext.get(editContext.size - 2) as ID,
          editContext.slice(0, -2).toList(),
        ]
      : [editedNodeID, editContext];

  const versionNode = newNode(newText);
  const withVersionNode = walkUpsertNode(ctx, versionNode);

  const versionsNode = newNode("~versions");
  const withVersionsNode = walkUpsertNode(withVersionNode, versionsNode);

  const versionsContext = getVersionsContext(originalNodeID, context);
  const containingRelation = root
    ? undefined
    : context.size > 0
      ? getRelationsForContext(
          withVersionsNode.knowledgeDBs,
          withVersionsNode.publicKey,
          context.last() as ID,
          context.butLast().toList(),
          undefined,
          context.size === 1
        )
      : getRelationsForContext(
          withVersionsNode.knowledgeDBs,
          withVersionsNode.publicKey,
          originalNodeID,
          context,
          undefined,
          true
        );
  const effectiveRoot = root ?? containingRelation?.root;
  const baseVersionsRelations =
    getVersionsRelations(
      withVersionsNode.knowledgeDBs,
      withVersionsNode.publicKey,
      originalNodeID,
      context
    ) ||
    newRelations(VERSIONS_NODE_ID, versionsContext, withVersionsNode.publicKey, effectiveRoot);

  const originalIndex = baseVersionsRelations.items.findIndex(
    (item) => item.nodeID === originalNodeID
  );
  const versionsWithOriginal =
    originalIndex < 0
      ? addRelationToRelations(
          baseVersionsRelations,
          originalNodeID,
          undefined,
          undefined,
          baseVersionsRelations.items.size
        )
      : baseVersionsRelations;

  const editedNodePosition = isInsideVersions
    ? versionsWithOriginal.items.findIndex(
        (item) => item.nodeID === editedNodeID
      )
    : -1;
  const insertPosition = editedNodePosition >= 0 ? editedNodePosition : 0;

  const existingIndex = versionsWithOriginal.items.findIndex(
    (item) => item.nodeID === versionNode.id
  );

  const withVersion =
    existingIndex >= 0
      ? moveRelations(versionsWithOriginal, [existingIndex], insertPosition)
      : addRelationToRelations(
          versionsWithOriginal,
          versionNode.id,
          undefined,
          undefined,
          insertPosition
        );

  return walkUpsertRelation(withVersionsNode, withVersion);
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  context: List<ID>,
  root: ID
): [WalkContext, ID] {
  const node = newNode(treeNode.text);
  const withNode = walkUpsertNode(ctx, node);

  const childContext = context.push(node.id);
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childItems] = visibleChildren.reduce(
    ([accCtx, accItems], childNode) => {
      if (childNode.linkHref) {
        const parts = childNode.linkHref.split(":");
        const relationID = joinID(accCtx.publicKey, parts[0]);
        const targetNode = parts.length > 1 ? (parts.slice(1).join(":") as ID) : undefined;
        const item: RelationItem = {
          nodeID: createConcreteRefId(relationID, targetNode),
          relevance: childNode.relevance,
          argument: childNode.argument,
        };
        return [accCtx, [...accItems, item]] as [WalkContext, RelationItem[]];
      }
      const childID = hashText(childNode.text);
      const isDuplicate = accItems.some((item) => item.nodeID === childID);
      const effectiveChild = isDuplicate
        ? {
            ...childNode,
            text: findUniqueText(
              childNode.text,
              accItems.map((item) => item.nodeID)
            ),
          }
        : childNode;
      const [afterChild, materializedID] = materializeTreeNode(
        accCtx,
        effectiveChild,
        childContext,
        root
      );
      const afterVersion = isDuplicate
        ? createVersion(afterChild, materializedID, childNode.text, childContext, root)
        : afterChild;
      const item: RelationItem = {
        nodeID: materializedID,
        relevance: childNode.relevance,
        argument: childNode.argument,
      };
      return [afterVersion, [...accItems, item]];
    },
    [withNode, [] as RelationItem[]] as [WalkContext, RelationItem[]]
  );

  const hiddenChildren = treeNode.children.filter((child) => child.hidden);
  const withHidden = hiddenChildren.reduce(
    (accCtx, child) => materializeTreeNode(accCtx, child, childContext, root)[0],
    withVisible
  );

  const baseRelation = treeNode.uuid
    ? {
        ...newRelations(node.id, context, withHidden.publicKey, root),
        id: joinID(withHidden.publicKey, treeNode.uuid),
      }
    : newRelations(node.id, context, withHidden.publicKey, root);
  const relation: Relations = {
    ...baseRelation,
    items: List(childItems),
    ...(treeNode.basedOn
      ? { basedOn: joinID(withHidden.publicKey, treeNode.basedOn) as LongID }
      : {}),
    ...(withHidden.updated !== undefined ? { updated: withHidden.updated } : {}),
  };
  return [walkUpsertRelation(withHidden, relation), node.id];
}

export function createNodesFromMarkdownTrees(
  ctx: WalkContext,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [WalkContext, topNodeIDs: ID[]] {
  return trees.reduce(
    ([accCtx, accTopNodeIDs], treeNode) => {
      const rootUuid = treeNode.uuid ?? v4();
      const treeWithUuid = treeNode.uuid
        ? treeNode
        : { ...treeNode, uuid: rootUuid };
      const [nextCtx, topNodeID] = materializeTreeNode(
        accCtx,
        treeWithUuid,
        context,
        rootUuid as ID
      );
      return [nextCtx, [...accTopNodeIDs, topNodeID]];
    },
    [ctx, [] as ID[]] as [WalkContext, ID[]]
  );
}

export function parseDocumentEvent(event: UnsignedEvent): {
  nodes: Map<string, KnowNode>;
  relations: Map<string, Relations>;
} {
  const dTagValue = findTag(event, "d");
  if (!dTagValue) {
    return { nodes: Map(), relations: Map() };
  }

  const author = event.pubkey as PublicKey;
  const trees = parseMarkdownHierarchy(event.content);
  const ctx: WalkContext = {
    knowledgeDBs: Map<PublicKey, KnowledgeData>(),
    publicKey: author,
    affectedRoots: ImmutableSet<ID>(),
    updated: event.created_at * 1000,
  };
  const [result] = createNodesFromMarkdownTrees(ctx, trees);
  const db = result.knowledgeDBs.get(author);
  return {
    nodes: db?.nodes ?? Map<string, KnowNode>(),
    relations: db?.relations ?? Map<string, Relations>(),
  };
}
