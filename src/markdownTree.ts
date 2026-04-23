/* eslint-disable functional/immutable-data, functional/no-let, no-continue */
import { List } from "immutable";
import MarkdownIt from "markdown-it";
import markdownItFrontMatter from "markdown-it-front-matter";
// eslint-disable-next-line import/no-unresolved
import Token from "markdown-it/lib/token";
import { LOG_ROOT_ROLE } from "./systemRoots";

const markdown = new MarkdownIt({ html: true });
markdown.use(markdownItFrontMatter, () => undefined);

const ID_COMMENT_RE = /^<!--\s+id:(\S+)(.*?)-->$/;
const ATTR_RE = /(\w+)="([^"]*)"/g;

const RELEVANCE_CHARS: Record<string, Relevance> = {
  "!": "relevant",
  "?": "maybe_relevant",
  "~": "little_relevant",
  x: "not_relevant",
};

const ARGUMENT_CHARS: Record<string, Argument> = {
  "+": "confirms",
  "-": "contra",
};

const PREFIX_RE = /^(\([!?~x+-]{1,2}\)\s*)+/;

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

function stripTrailingHtmlComment(
  content: string,
  comment: string | undefined
): string {
  if (!comment) {
    return content;
  }
  const trimmed = content.trimEnd();
  return trimmed.endsWith(comment)
    ? trimmed.slice(0, -comment.length)
    : content;
}

function isIdComment(token: Token): boolean {
  return (
    token.type === "html_inline" && ID_COMMENT_RE.test(token.content.trim())
  );
}

function extractCommentAttrs(inline: Token): ParsedComment | undefined {
  if (!inline.children) {
    return undefined;
  }
  const htmlInline = inline.children.find(isIdComment);
  if (!htmlInline) {
    return undefined;
  }
  return parseIdComment(htmlInline.content);
}

function childrenToText(children: readonly Token[]): string {
  return children
    .map((c) => {
      if (c.type === "softbreak" || c.type === "hardbreak") return " ";
      if (c.type === "code_inline") return `\`${c.content}\``;
      return c.content;
    })
    .join("");
}

function extractRefLink(
  children: readonly Token[]
): { prefixSource: string; text: string; linkHref: string } | undefined {
  const tokens = children.filter((c) => !isIdComment(c));
  const openIdx = tokens.findIndex((c) => c.type === "link_open");
  if (openIdx < 0) return undefined;
  const closeIdx = tokens.findIndex(
    (c, i) => i > openIdx && c.type === "link_close"
  );
  if (closeIdx < 0) return undefined;

  const href = tokens[openIdx].attrGet("href");
  if (!href || !href.startsWith("#")) return undefined;

  const trailing = tokens.slice(closeIdx + 1);
  const trailingIsBlank = trailing.every(
    (c) => c.type === "text" && c.content.trim() === ""
  );
  if (!trailingIsBlank) return undefined;

  const leading = tokens.slice(0, openIdx);
  const prefixSource = childrenToText(leading);
  if (prefixSource.replace(PREFIX_RE, "").trim() !== "") return undefined;

  const inner = tokens.slice(openIdx + 1, closeIdx);
  const text = childrenToText(inner).replace(/\n/g, " ").trim();
  return { prefixSource, text, linkHref: href.slice(1) };
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
    (acc, tok) => {
      const inner = tok.slice(1, -1);
      return [...inner].reduce(
        (a, ch) => ({
          relevance: RELEVANCE_CHARS[ch] || a.relevance,
          argument: ARGUMENT_CHARS[ch] || a.argument,
        }),
        acc
      );
    },
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
  const refLink = extractRefLink(inline.children);
  if (refLink) {
    const { relevance, argument } = extractPrefixMarkers(refLink.prefixSource);
    return {
      text: refLink.text,
      linkHref: refLink.linkHref,
      relevance,
      argument,
    };
  }
  const commentChild = inline.children.find(isIdComment);
  const stripped = stripTrailingHtmlComment(
    inline.content,
    commentChild?.content
  );
  const raw = stripped.replace(/\n/g, " ").trim();
  const { cleanText, relevance, argument } = extractPrefixMarkers(raw);
  return {
    text: cleanText,
    relevance,
    argument,
  };
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
  frontMatter?: string;
  filePath?: string;
  uuid?: string;
  relevance?: Relevance;
  argument?: Argument;
  linkHref?: string;
  blockKind?: "heading" | "list_item" | "paragraph";
  headingLevel?: number;
  listOrdered?: boolean;
  listStart?: number;
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

type ListKind = { ordered: boolean; start: number };

export function parseMarkdownHierarchy(
  markdownText: string
): MarkdownTreeNode[] {
  const tokens = markdown.parse(markdownText, {});
  const roots: MarkdownTreeNode[] = [];
  const headingStack: Array<{ level: number; node: MarkdownTreeNode }> = [];
  const listItemStack: Array<MarkdownTreeNode | undefined> = [];
  const listKindStack: ListKind[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      const startAttr = token.attrGet("start");
      listKindStack.push({
        ordered: token.type === "ordered_list_open",
        start: startAttr ? Number(startAttr) : 1,
      });
      continue;
    }
    if (
      token.type === "bullet_list_close" ||
      token.type === "ordered_list_close"
    ) {
      listKindStack.pop();
      continue;
    }
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
        const currentListKind = listKindStack[listKindStack.length - 1];
        const node: MarkdownTreeNode = {
          text,
          children: [],
          blockKind: "list_item",
          ...(currentListKind?.ordered && {
            listOrdered: true,
            listStart: currentListKind.start,
          }),
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
