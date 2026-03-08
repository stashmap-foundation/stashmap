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
  nodeIDFromSeed,
  getNodeTextHash,
  isConcreteRefId,
  parseConcreteRefId,
  createConcreteRefId,
  VERSIONS_NODE_ID,
  addRelationToRelations,
  moveRelations,
  ensureRelationNativeFields,
  getRelationItemNodeID,
  getRelationItemRelation,
  getTextForMatching,
} from "./connections";
import {
  ViewPath,
  isRoot,
  getNodeIDFromView,
  getDisplayTextForView,
  getRelationItemForView,
  getContext,
  viewPathToString,
  newRelations,
  getVersionsContext,
  getVersionsRelations,
  getRelationsForCurrentTree,
  getVersionedDisplayText,
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
  linkRelevance?: Relevance;
  linkArgument?: Argument;
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
  const linkHref = href && href.startsWith("#") ? href.slice(1) : undefined;
  const linkClass = linkOpen?.attrGet("class") || "";
  const linkClasses = linkClass.split(" ").filter(Boolean);
  const linkRelevance = (
    ["relevant", "maybe_relevant", "little_relevant", "not_relevant"] as const
  ).find((r) => linkClasses.includes(r));
  const linkArgument = (["confirms", "contra"] as const).find((a) =>
    linkClasses.includes(a)
  );
  return { text, linkHref, linkRelevance, linkArgument };
}

function extractAttrs(token: Token): {
  uuid: string | undefined;
  nodeID: ID | undefined;
  relevance: Relevance;
  argument: Argument;
  hidden: boolean;
  basedOn: string | undefined;
  context: string | undefined;
} {
  if (!token.attrs) {
    return {
      uuid: undefined,
      nodeID: undefined,
      relevance: undefined,
      argument: undefined,
      hidden: false,
      basedOn: undefined,
      context: undefined,
    };
  }
  const uuid = token.attrs.find(([, value]) => value === "")?.[0];
  const nodeID = (token.attrGet("node") || undefined) as ID | undefined;
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
  const context = token.attrGet("context") || undefined;
  return { uuid, nodeID, relevance, argument, hidden, basedOn, context };
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
  uuid?: string;
  nodeID?: ID;
  relevance?: Relevance;
  argument?: Argument;
  linkHref?: string;
  hidden?: boolean;
  basedOn?: string;
  context?: string;
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
    nodeID: ID | undefined;
    relevance: Relevance;
    argument: Argument;
    hidden: boolean;
    basedOn: string | undefined;
  } = {
    uuid: undefined,
    nodeID: undefined,
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
      const { uuid, nodeID, relevance, argument, hidden, basedOn, context } =
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
        ...(uuid !== undefined && { uuid }),
        ...(nodeID !== undefined && { nodeID }),
        ...(relevance !== undefined && { relevance }),
        ...(argument !== undefined && { argument }),
        ...(hidden && { hidden }),
        ...(basedOn !== undefined && { basedOn }),
        ...(context !== undefined && { context }),
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
    const { text, linkHref, linkRelevance, linkArgument } =
      extractInlineContent(inline);
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
        const { uuid, nodeID, relevance, argument, hidden, basedOn } =
          pendingAttrs;
        const effectiveRelevance = linkRelevance ?? relevance;
        const effectiveArgument = linkArgument ?? argument;
        const node: MarkdownTreeNode = {
          text,
          children: [],
          ...(uuid !== undefined && { uuid }),
          ...(nodeID !== undefined && { nodeID }),
          ...(effectiveRelevance !== undefined && {
            relevance: effectiveRelevance,
          }),
          ...(effectiveArgument !== undefined && {
            argument: effectiveArgument,
          }),
          ...(linkHref !== undefined && { linkHref }),
          ...(hidden && { hidden }),
          ...(basedOn !== undefined && { basedOn }),
        };
        appendNode(roots, parent, node);
        listItemStack[currentItemIndex] = node;
        continue;
      }
      currentListNode.children.push({
        text,
        children: [],
        ...(linkHref !== undefined && { linkHref }),
        ...(linkRelevance !== undefined && { relevance: linkRelevance }),
        ...(linkArgument !== undefined && { argument: linkArgument }),
      });
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
  options?: { hidden?: boolean; basedOn?: LongID; nodeID?: ID }
): string {
  const parts: string[] = uuid ? [uuid] : [];
  if (options?.nodeID) {
    parts.push(`node="${options.nodeID}"`);
  }
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
  nodeID: LongID | ID
): string | undefined {
  const parsed = parseConcreteRefId(nodeID);
  if (!parsed) {
    return undefined;
  }
  const ref = buildOutgoingReference(nodeID as LongID, knowledgeDBs, author);
  if (!ref) {
    return undefined;
  }
  const href = parsed.targetNode
    ? `${parsed.relationID}:${parsed.targetNode}`
    : `${parsed.relationID}`;
  return `[${ref.text}](#${href})`;
}

type SerializeResult = {
  lines: string[];
  nodeHashes: ImmutableSet<string>;
  nodeIDs: ImmutableSet<string>;
  contextHashes: ImmutableSet<string>;
  relationUUIDs: ImmutableSet<string>;
};

function getOwnRelationForDocumentSerialization(
  data: Data,
  author: PublicKey,
  nodeID: LongID | ID,
  context: List<ID>,
  rootRelation: Relations,
  isRootNode: boolean
): Relations | undefined {
  return getRelationsForCurrentTree(
    data.knowledgeDBs,
    author,
    nodeID,
    context,
    rootRelation.id,
    isRootNode,
    rootRelation.root
  );
}

function getSerializedRelationText(
  data: Data,
  relation: Relations,
  nodeID: LongID | ID,
  context: List<ID>
): { text: string; textHash: ID } {
  const versionedText = getVersionedDisplayText(
    data.knowledgeDBs,
    relation.author,
    shortID(nodeID as ID) as ID,
    context,
    relation.root
  );
  if (versionedText) {
    return {
      text: versionedText,
      textHash: hashText(versionedText),
    };
  }

  if (relation.text !== "" || shortID(nodeID as ID) === VERSIONS_NODE_ID) {
    return {
      text: relation.text,
      textHash: relation.textHash,
    };
  }

  const fallbackText =
    getTextForMatching(data.knowledgeDBs, nodeID, relation.author) ??
    shortID(nodeID as ID);
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
  const stack = [rootRelation.head];
  const { paths, virtualItems } = getNodesInTree(
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
      const [nodeID] = getNodeIDFromView(data, path);
      const indent = "  ".repeat(depth);
      const context = getContext(data, path, stack);
      const contextHash =
        context.size > 0 ? hashText(context.join(":")) : undefined;
      const item = getRelationItemForView(data, path);
      const isVirtual = virtualItems.has(viewPathToString(path));

      if (isConcreteRefId(nodeID)) {
        const parsed = parseConcreteRefId(nodeID);
        const crefText = formatCrefText(data.knowledgeDBs, author, nodeID);
        if (!crefText || !parsed) return acc;
        const crefRelationUUID = shortID(parsed.relationID);
        const crefNodeHashes = parsed.targetNode
          ? acc.nodeHashes.add(
              hashText(
                getTextForMatching(
                  data.knowledgeDBs,
                  parsed.targetNode,
                  author
                ) ?? parsed.targetNode
              )
            )
          : acc.nodeHashes;
        const crefAttrs = formatAttrs("", item?.relevance, item?.argument, {
          hidden: isVirtual,
        });
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${crefText}${crefAttrs}`],
          nodeHashes: crefNodeHashes,
          nodeIDs: parsed.targetNode
            ? acc.nodeIDs.add(parsed.targetNode)
            : acc.nodeIDs,
          contextHashes: contextHash
            ? acc.contextHashes.add(contextHash)
            : acc.contextHashes,
          relationUUIDs: acc.relationUUIDs.add(crefRelationUUID),
        };
      }

      const ownRelation = getOwnRelationForDocumentSerialization(
        data,
        author,
        nodeID,
        context,
        rootRelation,
        isRoot(path)
      );
      const serializedRelation = ownRelation
        ? getSerializedRelationText(data, ownRelation, nodeID, context)
        : undefined;
      const text =
        serializedRelation?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();

      const line = `${indent}- ${text}${formatAttrs(
        uuid,
        item?.relevance,
        item?.argument,
        {
          hidden: isVirtual,
          basedOn: ownRelation?.basedOn,
          nodeID: shortID(nodeID) as ID,
        }
      )}`;
      return {
        lines: [...acc.lines, line],
        nodeHashes: acc.nodeHashes.add(
          serializedRelation?.textHash ?? hashText(text)
        ),
        nodeIDs: acc.nodeIDs.add(shortID(nodeID)),
        contextHashes: contextHash
          ? acc.contextHashes.add(contextHash)
          : acc.contextHashes,
        relationUUIDs: acc.relationUUIDs.add(uuid),
      };
    },
    {
      lines: [],
      nodeHashes: ImmutableSet<string>(),
      nodeIDs: ImmutableSet<string>(),
      contextHashes: ImmutableSet<string>(),
      relationUUIDs: ImmutableSet<string>(),
    }
  );
}

function formatRootHeading(
  rootText: string,
  rootUuid: string,
  rootNodeID: ID,
  context: List<ID>
): string {
  const parts = [rootUuid, `node="${rootNodeID}"`];
  if (context.size > 0) {
    parts.push(`context="${context.join(":")}"`);
  }
  return `# ${rootText} {${parts.join(" ")}}`;
}

export function treeToMarkdown(data: Data, rootRelation: Relations): string {
  const { text: rootText } = getSerializedRelationText(
    data,
    rootRelation,
    rootRelation.head,
    rootRelation.context
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootRelation.head as ID,
    rootRelation.context
  );
  const { lines } = serializeTree(data, rootRelation);
  return `${[rootLine, ...lines].join("\n")}\n`;
}

export function buildDocumentEvent(
  data: Data,
  rootRelation: Relations
): UnsignedEvent {
  const author = data.user.publicKey;
  const { text: rootText, textHash: rootTextHash } = getSerializedRelationText(
    data,
    rootRelation,
    rootRelation.head,
    rootRelation.context
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootRelation.head as ID,
    rootRelation.context
  );
  const result = serializeTree(data, rootRelation);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const nTags = result.nodeHashes
    .add(rootTextHash)
    .union(result.nodeIDs.add(rootRelation.head))
    .toArray()
    .map((value) => ["n", value]);
  const rootContextHash =
    rootRelation.context.size > 0
      ? hashText(rootRelation.context.join(":"))
      : undefined;
  const allContextHashes = rootContextHash
    ? result.contextHashes.add(rootContextHash)
    : result.contextHashes;
  const cTags = allContextHashes.toArray().map((h) => ["c", h]);
  const rTags = result.relationUUIDs
    .add(rootUuid)
    .toArray()
    .map((u) => ["r", u]);

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...nTags, ...cTags, ...rTags, msTag()],
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

export function createVersion(
  ctx: WalkContext,
  editedNodeID: ID,
  newText: string,
  editContext: List<ID>,
  root: ID
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

  const versionsNode = newNode("~versions");

  const versionsContext = getVersionsContext(originalNodeID, context);
  const parentRelation = getRelationsForCurrentTree(
    ctx.knowledgeDBs,
    ctx.publicKey,
    originalNodeID,
    context,
    undefined,
    context.size === 0,
    root
  );
  const baseVersionsRelations =
    getVersionsRelations(
      ctx.knowledgeDBs,
      ctx.publicKey,
      originalNodeID,
      context,
      root
    ) ||
    newRelations(
      VERSIONS_NODE_ID,
      versionsContext,
      ctx.publicKey,
      root,
      parentRelation?.id
    );

  const versionItemContext = versionsContext.push(VERSIONS_NODE_ID);
  const ensureVersionRelation = (
    accCtx: WalkContext,
    nodeID: ID,
    text: string
  ): [WalkContext, LongID] => {
    const versionRelation = {
      ...newRelations(nodeID, versionItemContext, accCtx.publicKey, root),
      text,
      textHash: hashText(text),
      parent: baseVersionsRelations.id,
    };
    return [walkUpsertRelation(accCtx, versionRelation), versionRelation.id];
  };

  const originalIndex = baseVersionsRelations.items.findIndex(
    (item) =>
      getRelationItemNodeID(
        ctx.knowledgeDBs,
        item,
        ctx.publicKey
      ) === originalNodeID
  );
  const [withOriginalRelation, originalRelationID] =
    originalIndex < 0
      ? ensureVersionRelation(
          ctx,
          originalNodeID,
          getTextForMatching(
            ctx.knowledgeDBs,
            originalNodeID,
            ctx.publicKey
          ) ?? ""
        )
      : [
          ctx,
          getRelationItemRelation(
            ctx.knowledgeDBs,
            baseVersionsRelations.items.get(originalIndex)!,
            ctx.publicKey
          )!.id,
        ];
  const versionsWithOriginal =
    originalIndex < 0
      ? addRelationToRelations(
          baseVersionsRelations,
          originalRelationID,
          undefined,
          undefined,
          baseVersionsRelations.items.size
        )
      : baseVersionsRelations;

  const editedNodePosition = isInsideVersions
    ? versionsWithOriginal.items.findIndex(
        (item) =>
          getRelationItemNodeID(
            withOriginalRelation.knowledgeDBs,
            item,
            withOriginalRelation.publicKey
          ) === editedNodeID
      )
    : -1;
  const insertPosition = editedNodePosition >= 0 ? editedNodePosition : 0;

  const [withVersionRelation, versionRelationID] = ensureVersionRelation(
    withOriginalRelation,
    versionNode.id,
    newText
  );
  const existingIndex = versionsWithOriginal.items.findIndex(
    (item) =>
      getRelationItemNodeID(
        withVersionRelation.knowledgeDBs,
        item,
        withVersionRelation.publicKey
      ) === versionNode.id
  );

  const withVersion =
    existingIndex >= 0
      ? moveRelations(versionsWithOriginal, [existingIndex], insertPosition)
      : addRelationToRelations(
          versionsWithOriginal,
          versionRelationID,
          undefined,
          undefined,
          insertPosition
        );

  return walkUpsertRelation(withVersionRelation, withVersion);
}

function materializeTreeNode(
  ctx: WalkContext,
  treeNode: MarkdownTreeNode,
  context: List<ID>,
  root: ID,
  parent?: LongID
): [WalkContext, ID, LongID] {
  const node = newNode(
    treeNode.text,
    treeNode.nodeID ??
      (treeNode.uuid ? nodeIDFromSeed(treeNode.uuid) : undefined)
  );
  const baseRelation = treeNode.uuid
    ? {
        ...newRelations(node.id, context, ctx.publicKey, root),
        id: joinID(ctx.publicKey, treeNode.uuid),
      }
    : newRelations(node.id, context, ctx.publicKey, root);
  const relationBaseWithFields: Relations = {
    ...baseRelation,
    text: node.text,
    textHash: getNodeTextHash(node) ?? hashText(node.text),
    parent,
  };

  const childContext = context.push(node.id);
  const visibleChildren = treeNode.children.filter((child) => !child.hidden);
  const [withVisible, childItems] = visibleChildren.reduce(
    ([accCtx, accItems], childNode) => {
      if (childNode.linkHref) {
        const parts = childNode.linkHref.split(":");
        const relationID = parts[0] as LongID;
        const targetNode =
          parts.length > 1 ? (parts.slice(1).join(":") as ID) : undefined;
        const item: RelationItem = {
          id: createConcreteRefId(relationID, targetNode),
          relevance: childNode.relevance,
          argument: childNode.argument,
          linkText: childNode.text,
        };
        return [accCtx, [...accItems, item]] as [WalkContext, RelationItem[]];
      }
      const [afterChild, materializedID, materializedRelationID] =
        materializeTreeNode(
          accCtx,
          childNode,
          childContext,
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

  const hiddenChildren = treeNode.children.filter((child) => child.hidden);
  const withHidden = hiddenChildren.reduce(
    (accCtx, child) =>
      materializeTreeNode(
        accCtx,
        child,
        childContext,
        root,
        relationBaseWithFields.id
      )[0],
    withVisible
  );

  const relation: Relations = {
    ...relationBaseWithFields,
    items: List(childItems),
    ...(treeNode.basedOn
      ? {
          basedOn: (treeNode.basedOn.includes("_")
            ? treeNode.basedOn
            : joinID(withHidden.publicKey, treeNode.basedOn)) as LongID,
        }
      : {}),
    ...(withHidden.updated !== undefined
      ? { updated: withHidden.updated }
      : {}),
  };
  return [walkUpsertRelation(withHidden, relation), node.id, relation.id];
}

export function createNodesFromMarkdownTrees(
  ctx: WalkContext,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [WalkContext, topNodeIDs: ID[], topRelationIDs: LongID[]] {
  return trees.reduce(
    ([accCtx, accTopNodeIDs, accTopRelationIDs], treeNode) => {
      const rootUuid = treeNode.uuid ?? v4();
      const treeWithUuid = treeNode.uuid
        ? treeNode
        : { ...treeNode, uuid: rootUuid };
      const treeContext = treeNode.context
        ? List(treeNode.context.split(":") as ID[])
        : context;
      const [nextCtx, topNodeID, topRelationID] = materializeTreeNode(
        accCtx,
        treeWithUuid,
        treeContext,
        rootUuid as ID
      );
      return [
        nextCtx,
        [...accTopNodeIDs, topNodeID],
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
