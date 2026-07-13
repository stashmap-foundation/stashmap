import MarkdownIt from "markdown-it";
import markdownItFrontMatter from "markdown-it-front-matter";
// eslint-disable-next-line import/no-unresolved
import Token from "markdown-it/lib/token";
import { plainSpans, spansText } from "./nodeSpans";
import { docLinkId, isMarkdownPath } from "./linkPath";
import { parseFrontMatter } from "./knowstrFrontmatter";
import { isSafeMarkdownNodeId } from "./graphLookup";

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
  basedOn: string | undefined;
  snapshotId: string | undefined;
  extraAttrs: Record<string, string> | undefined;
  systemRole: RootSystemRole | undefined;
};

function parseIdComment(content: string): ParsedComment | undefined {
  const match = content.trim().match(ID_COMMENT_RE);
  if (!match) {
    return undefined;
  }
  const uuid = match[1];
  if (!isSafeMarkdownNodeId(uuid)) {
    throw new Error(`Invalid markdown node id: ${uuid}`);
  }
  const rest = match[2];

  const { attrsMap, extraAttrs } = [...rest.matchAll(ATTR_RE)].reduce<{
    attrsMap: Record<string, string>;
    extraAttrs: Record<string, string>;
  }>(
    (attrs, [, key, value]) => ({
      attrsMap: { ...attrs.attrsMap, [key]: value },
      extraAttrs:
        key === "basedOn" || key === "snapshot"
          ? attrs.extraAttrs
          : { ...attrs.extraAttrs, [key]: value },
    }),
    { attrsMap: {}, extraAttrs: {} }
  );

  const basedOn = attrsMap.basedOn || undefined;
  const snapshotId = attrsMap.snapshot || undefined;
  return {
    uuid,
    basedOn,
    snapshotId,
    extraAttrs: Object.keys(extraAttrs).length > 0 ? extraAttrs : undefined,
    systemRole: undefined,
  };
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

function supportedHref(href: string): boolean {
  const filePath = href.split("#")[0];
  return (
    (href.startsWith("#") && href.length > 1) ||
    docLinkId(filePath) !== undefined ||
    isMarkdownPath(filePath)
  );
}

function tokenSource(token: Token): string {
  if (token.type === "softbreak" || token.type === "hardbreak") return " ";
  if (token.type === "code_inline") {
    return `${token.markup}${token.content}${token.markup}`;
  }
  if (token.type.endsWith("_open") || token.type.endsWith("_close")) {
    return token.markup;
  }
  return token.content;
}

function appendSpan(spans: InlineSpan[], span: InlineSpan): InlineSpan[] {
  if (span.text === "") return spans;
  const previous = spans[spans.length - 1];
  if (previous?.kind === "text" && span.kind === "text") {
    return [
      ...spans.slice(0, -1),
      { kind: "text", text: previous.text + span.text },
    ];
  }
  return [...spans, span];
}

function extractSpans(children: readonly Token[]): InlineSpan[] {
  const tokens = children.filter((token) => !isIdComment(token));
  const extractFrom = (index: number, spans: InlineSpan[]): InlineSpan[] => {
    if (index >= tokens.length) return spans;
    const token = tokens[index];
    if (token.type !== "link_open") {
      return extractFrom(
        index + 1,
        appendSpan(spans, { kind: "text", text: tokenSource(token) })
      );
    }
    const relativeCloseIndex = tokens
      .slice(index + 1)
      .findIndex((candidate) => candidate.type === "link_close");
    if (relativeCloseIndex < 0) {
      return extractFrom(index + 1, spans);
    }
    const closeIndex = index + relativeCloseIndex + 1;
    const href = token.attrGet("href") ?? "";
    const title = token.attrGet("title");
    const inner = tokens.slice(index + 1, closeIndex);
    const text = childrenToText(inner).replace(/\n/g, " ").trim();
    const span =
      supportedHref(href) && title === null && text !== ""
        ? { kind: "link" as const, href, text }
        : {
            kind: "text" as const,
            text: `[${inner.map(tokenSource).join("")}](${href}${
              title === null ? "" : ` "${title}"`
            })`,
          };
    return extractFrom(closeIndex + 1, appendSpan(spans, span));
  };
  return extractFrom(0, []);
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

function trimParsedSpans(spans: InlineSpan[]): InlineSpan[] {
  const lastIndex = spans.length - 1;
  return spans
    .map((span, index) => {
      if (index === 0 && index === lastIndex) {
        return { ...span, text: span.text.trim() };
      }
      if (index === 0) return { ...span, text: span.text.trimStart() };
      if (index === lastIndex) return { ...span, text: span.text.trimEnd() };
      return span;
    })
    .filter((span) => span.text !== "");
}

function extractInlineContent(inline: Token): {
  spans: InlineSpan[];
  relevance?: Relevance;
  argument?: Argument;
} {
  if (!inline.children) {
    const raw = inline.content.trim();
    const { cleanText, relevance, argument } = extractPrefixMarkers(raw);
    return {
      spans: plainSpans(cleanText),
      relevance,
      argument,
    };
  }
  const parsedSpans = trimParsedSpans(extractSpans(inline.children));
  const first = parsedSpans[0];
  const prefix = extractPrefixMarkers(first?.kind === "text" ? first.text : "");
  const spans =
    first?.kind === "text"
      ? [
          ...(prefix.cleanText === "" ? [] : [plainSpans(prefix.cleanText)[0]]),
          ...parsedSpans.slice(1),
        ]
      : parsedSpans;
  return {
    spans,
    relevance: prefix.relevance,
    argument: prefix.argument,
  };
}

export type MarkdownTreeNode = {
  spans: InlineSpan[];
  children: MarkdownTreeNode[];
  docId?: string;
  uuid?: string;
  relevance?: Relevance;
  argument?: Argument;
  blockKind?: "heading" | "list_item" | "paragraph";
  headingLevel?: number;
  listOrdered?: boolean;
  listStart?: number;
  basedOn?: string;
  snapshotId?: string;
  extraAttrs?: Record<string, string>;
  systemRole?: RootSystemRole;
};

type NodePath = readonly number[];

type AppendResult = {
  nodes: MarkdownTreeNode[];
  path: NodePath;
};

function appendNodeAtPath(
  nodes: MarkdownTreeNode[],
  parentPath: NodePath,
  node: MarkdownTreeNode,
  pathPrefix: NodePath = []
): AppendResult {
  if (parentPath.length === 0) {
    return {
      nodes: [...nodes, node],
      path: [...pathPrefix, nodes.length],
    };
  }
  const parentIndex = parentPath[0];
  const parent = nodes[parentIndex];
  if (!parent) {
    throw new Error("Invalid markdown tree parent path");
  }
  const nested = appendNodeAtPath(parent.children, parentPath.slice(1), node, [
    ...pathPrefix,
    parentIndex,
  ]);
  return {
    nodes: nodes.map((current, index) =>
      index === parentIndex ? { ...current, children: nested.nodes } : current
    ),
    path: nested.path,
  };
}

function getLastDefinedPath(
  pathStack: readonly (NodePath | undefined)[]
): NodePath | undefined {
  return pathStack.reduceRight<NodePath | undefined>(
    (found, path) => found ?? path,
    undefined
  );
}

type ListKind = { ordered: boolean; start: number };

function commentNodeAttrs(
  commentAttrs: ParsedComment | undefined
): Partial<MarkdownTreeNode> {
  return {
    ...(commentAttrs?.uuid !== undefined && { uuid: commentAttrs.uuid }),
    ...(commentAttrs?.basedOn !== undefined && {
      basedOn: commentAttrs.basedOn,
    }),
    ...(commentAttrs?.snapshotId !== undefined && {
      snapshotId: commentAttrs.snapshotId,
    }),
    ...(commentAttrs?.extraAttrs !== undefined && {
      extraAttrs: commentAttrs.extraAttrs,
    }),
    ...(commentAttrs?.systemRole !== undefined && {
      systemRole: commentAttrs.systemRole,
    }),
  };
}

type BuildTreeState = {
  roots: MarkdownTreeNode[];
  headingStack: readonly { level: number; path: NodePath }[];
  listItemStack: readonly (NodePath | undefined)[];
  listKindStack: readonly ListKind[];
};

function buildTreeFromTokens(tokens: Token[]): MarkdownTreeNode[] {
  return tokens.reduce<BuildTreeState>(
    (state, token, index) => {
      if (
        token.type === "bullet_list_open" ||
        token.type === "ordered_list_open"
      ) {
        const startAttr = token.attrGet("start");
        return {
          ...state,
          listKindStack: [
            ...state.listKindStack,
            {
              ordered: token.type === "ordered_list_open",
              start: startAttr ? Number(startAttr) : 1,
            },
          ],
        };
      }
      if (
        token.type === "bullet_list_close" ||
        token.type === "ordered_list_close"
      ) {
        return {
          ...state,
          listKindStack: state.listKindStack.slice(0, -1),
        };
      }
      if (token.type === "heading_open") {
        const headingLevel = Number(token.tag.replace("h", ""));
        const inline = tokens[index + 1];
        if (!inline || inline.type !== "inline") return state;
        const { spans, relevance, argument } = extractInlineContent(inline);
        if (spansText(spans) === "") return state;
        const headingStack = state.headingStack.filter(
          (heading) => heading.level < headingLevel
        );
        const parentPath =
          getLastDefinedPath(state.listItemStack) ??
          headingStack[headingStack.length - 1]?.path ??
          [];
        const node: MarkdownTreeNode = {
          spans,
          children: [],
          blockKind: "heading",
          headingLevel,
          ...commentNodeAttrs(extractCommentAttrs(inline)),
          ...(relevance !== undefined && { relevance }),
          ...(argument !== undefined && { argument }),
        };
        const appended = appendNodeAtPath(state.roots, parentPath, node);
        return {
          ...state,
          roots: appended.nodes,
          headingStack: [
            ...headingStack,
            { level: headingLevel, path: appended.path },
          ],
        };
      }
      if (token.type === "list_item_open") {
        return {
          ...state,
          listItemStack: [...state.listItemStack, undefined],
        };
      }
      if (token.type === "list_item_close") {
        return {
          ...state,
          listItemStack: state.listItemStack.slice(0, -1),
        };
      }
      if (token.type !== "paragraph_open") return state;
      const inline = tokens[index + 1];
      if (!inline || inline.type !== "inline") return state;
      const { spans, relevance, argument } = extractInlineContent(inline);
      if (spansText(spans) === "") return state;
      const attrs = commentNodeAttrs(extractCommentAttrs(inline));
      if (state.listItemStack.length > 0) {
        const currentItemIndex = state.listItemStack.length - 1;
        const currentItemPath = state.listItemStack[currentItemIndex];
        if (!currentItemPath) {
          const parentPath =
            getLastDefinedPath(state.listItemStack.slice(0, -1)) ??
            state.headingStack[state.headingStack.length - 1]?.path ??
            [];
          const currentListKind =
            state.listKindStack[state.listKindStack.length - 1];
          const node: MarkdownTreeNode = {
            spans,
            children: [],
            blockKind: "list_item",
            ...(currentListKind?.ordered && {
              listOrdered: true,
              listStart: currentListKind.start,
            }),
            ...attrs,
            ...(relevance !== undefined && { relevance }),
            ...(argument !== undefined && { argument }),
          };
          const appended = appendNodeAtPath(state.roots, parentPath, node);
          return {
            ...state,
            roots: appended.nodes,
            listItemStack: [...state.listItemStack.slice(0, -1), appended.path],
          };
        }
        const paragraph: MarkdownTreeNode = {
          spans,
          children: [],
          blockKind: "paragraph",
          ...attrs,
          ...(relevance !== undefined && { relevance }),
          ...(argument !== undefined && { argument }),
        };
        return {
          ...state,
          roots: appendNodeAtPath(state.roots, currentItemPath, paragraph)
            .nodes,
        };
      }
      const paragraph: MarkdownTreeNode = {
        spans,
        children: [],
        blockKind: "paragraph",
        ...attrs,
        ...(relevance !== undefined && { relevance }),
        ...(argument !== undefined && { argument }),
      };
      return {
        ...state,
        roots: appendNodeAtPath(
          state.roots,
          state.headingStack[state.headingStack.length - 1]?.path ?? [],
          paragraph
        ).nodes,
      };
    },
    {
      roots: [],
      headingStack: [],
      listItemStack: [],
      listKindStack: [],
    }
  ).roots;
}

export type ParsedMarkdown = {
  tree: MarkdownTreeNode[];
  frontMatter?: FrontMatter;
};

export function parseMarkdown(markdownText: string): ParsedMarkdown {
  const tokens = markdown.parse(markdownText, {});
  const tree = buildTreeFromTokens(tokens);
  const frontMatterToken = tokens.find(
    (token) => token.type === "front_matter"
  );
  const innerYaml =
    typeof frontMatterToken?.meta === "string"
      ? frontMatterToken.meta
      : undefined;
  const frontMatter =
    innerYaml !== undefined ? parseFrontMatter(innerYaml) : undefined;
  return {
    tree,
    ...(frontMatter !== undefined ? { frontMatter } : {}),
  };
}
