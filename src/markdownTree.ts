/* eslint-disable functional/immutable-data, functional/no-let, no-continue */
import { List } from "immutable";
import MarkdownIt from "markdown-it";
// eslint-disable-next-line import/no-unresolved
import Token from "markdown-it/lib/token";
import { LOG_ROOT_ROLE } from "./systemRoots";

const markdown = new MarkdownIt({ html: true });

const ID_COMMENT_RE = /^<!--\s+id:(\S+)(.*?)-->$/;
const ATTR_RE = /(\w+)="([^"]*)"/g;

const RELEVANCE_PREFIXES: Record<string, Relevance> = {
  "(!)": "relevant",
  "(?)": "maybe_relevant",
  "(~)": "little_relevant",
  "(x)": "not_relevant",
};

const ARGUMENT_PREFIXES: Record<string, Argument> = {
  "(+)": "confirms",
  "(-)": "contra",
};

const PREFIX_RE = /^(\([!?~x+-]\)\s*)+/;

type ParsedComment = {
  uuid: string;
  hidden: boolean;
  basedOn: string | undefined;
  snapshotDTag: string | undefined;
  anchor: RootAnchor | undefined;
  systemRole: RootSystemRole | undefined;
  userPublicKey: PublicKey | undefined;
};

function parseIdComment(content: string): ParsedComment | undefined {
  const match = content.trim().match(ID_COMMENT_RE);
  if (!match) {
    return undefined;
  }
  const uuid = match[1];
  const rest = match[2];

  const attrsMap: Record<string, string> = {};
  [...rest.matchAll(ATTR_RE)].forEach(([, key, value]) => {
    attrsMap[key] = value;
  });

  const hidden = rest.includes(" hidden");
  const basedOn = attrsMap.basedOn || undefined;
  const snapshotDTag = attrsMap.snapshot || undefined;
  const anchorContext = attrsMap.anchorContext || undefined;
  const anchorLabelsAttr = attrsMap.anchorLabels || undefined;
  const sourceAuthor = attrsMap.sourceAuthor || undefined;
  const sourceRootID = (attrsMap.sourceRoot || undefined) as ID | undefined;
  const sourceNodeID = (attrsMap.sourceNode || undefined) as LongID | undefined;
  const sourceParentNodeID = (attrsMap.sourceParent || undefined) as
    | LongID
    | undefined;
  const rawSystemRole = attrsMap.systemRole || undefined;
  const systemRole =
    rawSystemRole === LOG_ROOT_ROLE ? LOG_ROOT_ROLE : undefined;
  const userPublicKey = (attrsMap.userPublicKey || undefined) as
    | PublicKey
    | undefined;

  const anchor =
    anchorContext ||
    anchorLabelsAttr ||
    sourceAuthor ||
    sourceRootID ||
    sourceNodeID ||
    sourceParentNodeID
      ? {
          snapshotContext: anchorContext
            ? List(anchorContext.split(":") as ID[])
            : List<ID>(),
          ...(anchorLabelsAttr
            ? {
                snapshotLabels: anchorLabelsAttr
                  .split("|")
                  .map((label) => decodeURIComponent(label)),
              }
            : {}),
          ...(sourceAuthor ? { sourceAuthor: sourceAuthor as PublicKey } : {}),
          ...(sourceRootID ? { sourceRootID } : {}),
          ...(sourceNodeID ? { sourceNodeID } : {}),
          ...(sourceParentNodeID ? { sourceParentNodeID } : {}),
        }
      : undefined;

  return {
    uuid,
    hidden,
    basedOn,
    snapshotDTag,
    anchor,
    systemRole,
    userPublicKey,
  };
}

function extractCommentAttrs(inline: Token): ParsedComment | undefined {
  if (!inline.children) {
    return undefined;
  }
  const htmlInline = inline.children.find(
    (c) => c.type === "html_inline" && ID_COMMENT_RE.test(c.content.trim())
  );
  if (!htmlInline) {
    return undefined;
  }
  return parseIdComment(htmlInline.content);
}

function extractPrefixMarkers(text: string): {
  cleanText: string;
  relevance: Relevance;
  argument: Argument;
} {
  const prefixMatch = text.match(PREFIX_RE);
  if (!prefixMatch) {
    return { cleanText: text, relevance: undefined, argument: undefined };
  }
  const prefixStr = prefixMatch[0];
  const cleanText = text.slice(prefixStr.length);
  const prefixTokens = prefixStr.trim().split(/\s+/);

  const { relevance, argument } = prefixTokens.reduce(
    (acc, tok) => ({
      relevance: RELEVANCE_PREFIXES[tok] || acc.relevance,
      argument: ARGUMENT_PREFIXES[tok] || acc.argument,
    }),
    { relevance: undefined as Relevance, argument: undefined as Argument }
  );

  return { cleanText, relevance, argument };
}

function extractInlineContent(inline: Token): {
  text: string;
  linkHref?: string;
  relevance?: Relevance;
  argument?: Argument;
} {
  if (!inline.children) {
    const raw = inline.content.trim();
    const { cleanText, relevance, argument } = extractPrefixMarkers(raw);
    return {
      text: cleanText,
      relevance,
      argument,
    };
  }
  const textParts = inline.children
    .filter((c) => c.type === "text" || c.type === "softbreak")
    .map((c) => (c.type === "softbreak" ? " " : c.content))
    .join("")
    .trim();
  const { cleanText, relevance, argument } = extractPrefixMarkers(textParts);

  const linkOpen = inline.children.find((c) => c.type === "link_open");
  const href = linkOpen?.attrGet("href");
  const linkHref = href && href.startsWith("#") ? href.slice(1) : undefined;

  return {
    text: cleanText,
    linkHref,
    relevance,
    argument,
  };
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
  uuid?: string;
  relevance?: Relevance;
  argument?: Argument;
  linkHref?: string;
  blockKind?: "heading" | "list_item" | "paragraph";
  headingLevel?: number;
  hidden?: boolean;
  basedOn?: string;
  snapshotDTag?: string;
  anchor?: RootAnchor;
  systemRole?: RootSystemRole;
  userPublicKey?: PublicKey;
};

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

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open") {
      const headingLevel = Number(token.tag.replace("h", ""));
      const inline = tokens[i + 1];
      if (!inline || inline.type !== "inline") {
        continue;
      }
      const { text, relevance, argument } = extractInlineContent(inline);
      if (!text) {
        continue;
      }
      const commentAttrs = extractCommentAttrs(inline);
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
        blockKind: "heading",
        headingLevel,
        ...(commentAttrs?.uuid !== undefined && { uuid: commentAttrs.uuid }),
        ...(relevance !== undefined && { relevance }),
        ...(argument !== undefined && { argument }),
        ...(commentAttrs?.hidden && { hidden: true }),
        ...(commentAttrs?.basedOn !== undefined && {
          basedOn: commentAttrs.basedOn,
        }),
        ...(commentAttrs?.snapshotDTag !== undefined && {
          snapshotDTag: commentAttrs.snapshotDTag,
        }),
        ...(commentAttrs?.anchor !== undefined && {
          anchor: commentAttrs.anchor,
        }),
        ...(commentAttrs?.systemRole !== undefined && {
          systemRole: commentAttrs.systemRole,
        }),
        ...(commentAttrs?.userPublicKey !== undefined && {
          userPublicKey: commentAttrs.userPublicKey,
        }),
      };
      appendNode(roots, parent, node);
      headingStack.push({ level: headingLevel, node });
      continue;
    }

    if (token.type === "list_item_open") {
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
    const { text, linkHref, relevance, argument } =
      extractInlineContent(inline);
    if (!text) {
      continue;
    }
    const commentAttrs = extractCommentAttrs(inline);

    if (listItemStack.length > 0) {
      const currentItemIndex = listItemStack.length - 1;
      const currentListNode = listItemStack[currentItemIndex];
      if (!currentListNode) {
        const parent =
          getLastDefinedListItem(listItemStack.slice(0, -1)) ||
          headingStack[headingStack.length - 1]?.node;
        const effectiveRelevance = relevance;
        const effectiveArgument = argument;
        const node: MarkdownTreeNode = {
          text,
          children: [],
          blockKind: "list_item",
          ...(commentAttrs?.uuid !== undefined && { uuid: commentAttrs.uuid }),
          ...(effectiveRelevance !== undefined && {
            relevance: effectiveRelevance,
          }),
          ...(effectiveArgument !== undefined && {
            argument: effectiveArgument,
          }),
          ...(linkHref !== undefined && { linkHref }),
          ...(commentAttrs?.hidden && { hidden: true }),
          ...(commentAttrs?.basedOn !== undefined && {
            basedOn: commentAttrs.basedOn,
          }),
          ...(commentAttrs?.snapshotDTag !== undefined && {
            snapshotDTag: commentAttrs.snapshotDTag,
          }),
          ...(commentAttrs?.userPublicKey !== undefined && {
            userPublicKey: commentAttrs.userPublicKey,
          }),
        };
        appendNode(roots, parent, node);
        listItemStack[currentItemIndex] = node;
        continue;
      }
      currentListNode.children.push({
        text,
        children: [],
        blockKind: "paragraph",
        ...(linkHref !== undefined && { linkHref }),
        ...(relevance !== undefined && { relevance }),
        ...(argument !== undefined && { argument }),
      });
      continue;
    }

    const paragraphNode: MarkdownTreeNode = {
      text,
      children: [],
      blockKind: "paragraph",
    };
    appendNode(
      roots,
      headingStack[headingStack.length - 1]?.node,
      paragraphNode
    );
  }
  return roots;
}

export function parseEditableMarkdownDocument(markdownText: string): {
  roots: MarkdownTreeNode[];
  mainRoot?: MarkdownTreeNode;
  deleteRoot?: MarkdownTreeNode;
  hasNestedDeleteSection: boolean;
} {
  const roots = parseMarkdownHierarchy(markdownText).filter(
    (root) => !root.hidden
  );
  const mainRoot = roots[0];
  const deleteRoot = roots[1];
  return {
    roots,
    mainRoot,
    deleteRoot,
    hasNestedDeleteSection: Boolean(
      mainRoot?.children.some((child) => child.text === "Delete")
    ),
  };
}
