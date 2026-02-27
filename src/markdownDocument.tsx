import { List, Map, Set as ImmutableSet } from "immutable";
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
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceNode";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { findTag, getEventMs } from "./commons/useNostrQuery";
import { getNodesInTree } from "./treeTraversal";

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
} {
  if (!token.attrs) {
    return { uuid: undefined, relevance: undefined, argument: undefined };
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
  return { uuid, relevance, argument };
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
  uuid?: string;
  relevance?: Relevance;
  argument?: Argument;
  linkHref?: string;
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
  } = { uuid: undefined, relevance: undefined, argument: undefined };

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
      const { uuid, relevance, argument } = extractAttrs(token);
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
        const { uuid, relevance, argument } = pendingAttrs;
        const node: MarkdownTreeNode = {
          text,
          children: [],
          uuid,
          relevance,
          argument,
          linkHref,
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
  argument: Argument
): string {
  const parts: string[] = uuid ? [uuid] : [];
  if (relevance) {
    parts.push(`.${relevance}`);
  }
  if (argument) {
    parts.push(`.${argument}`);
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
  const { paths } = getNodesInTree(
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

      const text = getDisplayTextForView(data, path, stack);
      // Leaf nodes have no relation, so no uuid
      const ownRelation = getRelationForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : "";

      const line = `${indent}- ${text}${formatAttrs(uuid, item?.relevance, item?.argument)}`;
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

function walkDocumentTree(
  treeNode: MarkdownTreeNode,
  context: List<ID>,
  author: PublicKey,
  root: ID,
  updated: number,
  acc: { nodes: Map<string, KnowNode>; relations: Map<string, Relations> }
): { nodes: Map<string, KnowNode>; relations: Map<string, Relations> } {
  const node = newNode(treeNode.text);
  const nodesWithThis = acc.nodes.set(node.id, node);

  if (!treeNode.uuid) {
    return { nodes: nodesWithThis, relations: acc.relations };
  }

  const childItems = List(
    treeNode.children.map((child) => {
      if (child.linkHref) {
        const parts = child.linkHref.split(":");
        const relationID = joinID(author, parts[0]);
        const targetNode = parts.length > 1 ? (parts.slice(1).join(":") as ID) : undefined;
        return {
          nodeID: createConcreteRefId(relationID, targetNode),
          relevance: child.relevance,
          argument: child.argument,
        };
      }
      return {
        nodeID: hashText(child.text) as LongID,
        relevance: child.relevance,
        argument: child.argument,
      };
    })
  );

  const relationID = joinID(author, treeNode.uuid);
  const relation: Relations = {
    id: relationID,
    head: node.id,
    context,
    items: childItems,
    author,
    root,
    updated,
  };

  const relationsWithThis = acc.relations.set(treeNode.uuid, relation);
  const childContext = context.push(node.id);

  return treeNode.children.reduce(
    (childAcc, child) =>
      walkDocumentTree(child, childContext, author, root, updated, childAcc),
    { nodes: nodesWithThis, relations: relationsWithThis }
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
  const root = dTagValue as ID;
  const updated = getEventMs(event);
  const trees = parseMarkdownHierarchy(event.content);

  return trees.reduce(
    (acc, tree) =>
      walkDocumentTree(tree, List<ID>(), author, root, updated, acc),
    {
      nodes: Map<string, KnowNode>(),
      relations: Map<string, Relations>(),
    }
  );
}
