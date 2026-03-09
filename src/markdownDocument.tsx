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
  createSemanticID,
  semanticIDFromSeed,
  isConcreteRefId,
  parseConcreteRefId,
  createConcreteRefId,
  ensureRelationNativeFields,
  getConcreteRefTargetRelation,
  getRelationItemNodeID,
  getRelationContext,
  getRelationSemanticID,
  getTextForSemanticID,
} from "./connections";
import {
  ViewPath,
  isRoot,
  getItemIDFromView,
  getDisplayTextForView,
  getCurrentEdgeForView,
  getRelationForView,
  getContext,
  viewPathToString,
  newRelations,
  getRelationsForCurrentTree,
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceRow";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { findTag } from "./commons/useNostrQuery";
import { getNodesInTree } from "./treeTraversal";
import { newDB } from "./knowledge";
import { createRootAnchor } from "./rootAnchor";

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
  anchor: RootAnchor | undefined;
} {
  if (!token.attrs) {
    return {
      uuid: undefined,
      nodeID: undefined,
      relevance: undefined,
      argument: undefined,
      hidden: false,
      basedOn: undefined,
      anchor: undefined,
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
  const sourceAuthor = token.attrGet("sourceAuthor") || undefined;
  const sourceRootID = (token.attrGet("sourceRoot") || undefined) as
    | ID
    | undefined;
  const sourceRelationID = (token.attrGet("sourceRelation") || undefined) as
    | LongID
    | undefined;
  const sourceParentRelationID = (
    token.attrGet("sourceParent") || undefined
  ) as LongID | undefined;
  const anchor =
    context ||
    sourceAuthor ||
    sourceRootID ||
    sourceRelationID ||
    sourceParentRelationID
      ? {
          snapshotContext: context
            ? List(context.split(":") as ID[])
            : List<ID>(),
          ...(sourceAuthor ? { sourceAuthor: sourceAuthor as PublicKey } : {}),
          ...(sourceRootID ? { sourceRootID } : {}),
          ...(sourceRelationID ? { sourceRelationID } : {}),
          ...(sourceParentRelationID ? { sourceParentRelationID } : {}),
        }
      : undefined;
  return { uuid, nodeID, relevance, argument, hidden, basedOn, anchor };
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
  anchor?: RootAnchor;
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
    anchor: RootAnchor | undefined;
  } = {
    uuid: undefined,
    nodeID: undefined,
    relevance: undefined,
    argument: undefined,
    hidden: false,
    basedOn: undefined,
    anchor: undefined,
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
      const { uuid, nodeID, relevance, argument, hidden, basedOn, anchor } =
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
        ...(anchor !== undefined && { anchor }),
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
  const targetRelation = getConcreteRefTargetRelation(
    knowledgeDBs,
    nodeID,
    author
  );
  const href = targetRelation ? `${targetRelation.id}` : `${parsed.relationID}`;
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
  path: ViewPath,
  stack: ID[],
  author: PublicKey,
  nodeID: LongID | ID,
  semanticContext: List<ID>,
  rootRelation: Relations,
  isRootNode: boolean
): Relations | undefined {
  const directRelation = getRelationForView(data, path, stack);
  if (directRelation) {
    return directRelation;
  }
  return getRelationsForCurrentTree(
    data.knowledgeDBs,
    author,
    nodeID,
    semanticContext,
    rootRelation.id,
    isRootNode,
    rootRelation.root
  );
}

function getSerializedRelationText(
  data: Data,
  relation: Relations,
  nodeID: LongID | ID,
  _context: List<ID>
): { text: string; textHash: ID } {
  if (relation.text !== "") {
    return {
      text: relation.text,
      textHash: relation.textHash,
    };
  }

  const fallbackText =
    getTextForSemanticID(data.knowledgeDBs, nodeID, relation.author) ??
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
  const stack = [getRelationSemanticID(rootRelation)];
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
      const [nodeID] = getItemIDFromView(data, path);
      const indent = "  ".repeat(depth);
      const context = getContext(data, path, stack);
      const contextHash =
        context.size > 0 ? hashText(context.join(":")) : undefined;
      const item = getCurrentEdgeForView(data, path);

      if (isConcreteRefId(nodeID)) {
        const parsed = parseConcreteRefId(nodeID);
        const crefText = formatCrefText(data.knowledgeDBs, author, nodeID);
        if (!crefText || !parsed) return acc;
        const targetRelation = getConcreteRefTargetRelation(
          data.knowledgeDBs,
          nodeID,
          author
        );
        const crefRelationUUID = shortID(
          (targetRelation?.id || parsed.relationID) as ID
        );
        const crefNodeHashes = targetRelation
          ? acc.nodeHashes.add(hashText(targetRelation.text))
          : acc.nodeHashes;
        const crefAttrs = formatAttrs("", item?.relevance, item?.argument);
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${crefText}${crefAttrs}`],
          nodeHashes: crefNodeHashes,
          nodeIDs: targetRelation
            ? acc.nodeIDs.add(getRelationSemanticID(targetRelation))
            : acc.nodeIDs,
          contextHashes: contextHash
            ? acc.contextHashes.add(contextHash)
            : acc.contextHashes,
          relationUUIDs: acc.relationUUIDs.add(crefRelationUUID),
        };
      }

      const ownRelation = getOwnRelationForDocumentSerialization(
        data,
        path,
        stack,
        author,
        nodeID,
        context,
        rootRelation,
        isRoot(path)
      );
      const serializedRelation = ownRelation
        ? getSerializedRelationText(
            data,
            ownRelation,
            getRelationSemanticID(ownRelation),
            context
          )
        : undefined;
      const serializedNodeID = ownRelation
        ? getRelationSemanticID(ownRelation)
        : (shortID(nodeID as ID) as ID);
      const text =
        serializedRelation?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();

      const line = `${indent}- ${text}${formatAttrs(
        uuid,
        item?.relevance,
        item?.argument,
        {
          basedOn: ownRelation?.basedOn,
          nodeID: serializedNodeID,
        }
      )}`;
      return {
        lines: [...acc.lines, line],
        nodeHashes: acc.nodeHashes.add(
          serializedRelation?.textHash ?? hashText(text)
        ),
        nodeIDs: acc.nodeIDs.add(serializedNodeID),
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
  anchor?: RootAnchor
): string {
  const parts = [rootUuid, `node="${rootNodeID}"`];
  if (anchor?.snapshotContext.size) {
    parts.push(`context="${anchor.snapshotContext.join(":")}"`);
  }
  if (anchor?.sourceAuthor) {
    parts.push(`sourceAuthor="${anchor.sourceAuthor}"`);
  }
  if (anchor?.sourceRootID) {
    parts.push(`sourceRoot="${anchor.sourceRootID}"`);
  }
  if (anchor?.sourceRelationID) {
    parts.push(`sourceRelation="${anchor.sourceRelationID}"`);
  }
  if (anchor?.sourceParentRelationID) {
    parts.push(`sourceParent="${anchor.sourceParentRelationID}"`);
  }
  return `# ${rootText} {${parts.join(" ")}}`;
}

export function treeToMarkdown(data: Data, rootRelation: Relations): string {
  const rootContext = getRelationContext(data.knowledgeDBs, rootRelation);
  const rootNodeID = getRelationSemanticID(rootRelation);
  const { text: rootText } = getSerializedRelationText(
    data,
    rootRelation,
    rootNodeID,
    rootContext
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootNodeID,
    rootRelation.anchor ?? createRootAnchor(rootContext)
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
  const rootNodeID = getRelationSemanticID(rootRelation);
  const { text: rootText, textHash: rootTextHash } = getSerializedRelationText(
    data,
    rootRelation,
    rootNodeID,
    rootContext
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootNodeID,
    rootRelation.anchor ?? createRootAnchor(rootContext)
  );
  const result = serializeTree(data, rootRelation);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const nTags = result.nodeHashes
    .add(rootTextHash)
    .union(result.nodeIDs.add(rootNodeID))
    .toArray()
    .map((value) => ["n", value]);
  const rootContextHash =
    rootContext.size > 0
      ? hashText(rootContext.join(":"))
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
      treeNode.nodeID ??
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
      const [afterChild, materializedID, materializedRelationID] =
        materializeTreeNode(
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
  return [walkUpsertRelation(withVisible, relation), relation.textHash, relation.id];
}

export function createNodesFromMarkdownTrees(
  ctx: WalkContext,
  trees: MarkdownTreeNode[],
  semanticContext: List<ID> = List<ID>()
): [WalkContext, topNodeIDs: ID[], topRelationIDs: LongID[]] {
  return trees.filter((treeNode) => !treeNode.hidden).reduce(
    ([accCtx, accTopNodeIDs, accTopRelationIDs], treeNode) => {
      const rootUuid = treeNode.uuid ?? v4();
      const treeWithUuid = treeNode.uuid
        ? treeNode
        : { ...treeNode, uuid: rootUuid };
      const treeSemanticContext =
        treeNode.anchor?.snapshotContext ?? semanticContext;
      const [nextCtx, topNodeID, topRelationID] = materializeTreeNode(
        accCtx,
        treeWithUuid,
        treeSemanticContext,
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
