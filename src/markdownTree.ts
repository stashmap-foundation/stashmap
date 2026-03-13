/* eslint-disable functional/immutable-data, functional/no-let, no-continue */
import { List } from "immutable";
import MarkdownIt from "markdown-it";
import attrs from "markdown-it-attrs";
// eslint-disable-next-line import/no-unresolved
import Token from "markdown-it/lib/token";
import { LOG_ROOT_ROLE } from "./systemRoots";

const markdown = new MarkdownIt({ html: true });
markdown.use(attrs);

function isCommentOnlyContent(value: string): boolean {
  return /^(?:<!--[\s\S]*?-->\s*)+$/.test(value.trim());
}

function extractInlineContent(inline: Token): {
  text: string;
  linkHref?: string;
  linkRelevance?: Relevance;
  linkArgument?: Argument;
} {
  if (!inline.children) {
    return {
      text: isCommentOnlyContent(inline.content) ? "" : inline.content.trim(),
    };
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
  return {
    text: isCommentOnlyContent(text) ? "" : text,
    linkHref,
    linkRelevance,
    linkArgument,
  };
}

function extractAttrs(token: Token): {
  uuid: string | undefined;
  relevance: Relevance;
  argument: Argument;
  hidden: boolean;
  basedOn: string | undefined;
  anchor: RootAnchor | undefined;
  systemRole: RootSystemRole | undefined;
  userPublicKey: PublicKey | undefined;
} {
  if (!token.attrs) {
    return {
      uuid: undefined,
      relevance: undefined,
      argument: undefined,
      hidden: false,
      basedOn: undefined,
      anchor: undefined,
      systemRole: undefined,
      userPublicKey: undefined,
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
  const anchorContext = token.attrGet("anchorContext") || undefined;
  const anchorLabelsAttr = token.attrGet("anchorLabels") || undefined;
  const sourceAuthor = token.attrGet("sourceAuthor") || undefined;
  const sourceRootID = (token.attrGet("sourceRoot") || undefined) as
    | ID
    | undefined;
  const sourceRelationID = (token.attrGet("sourceRelation") || undefined) as
    | LongID
    | undefined;
  const sourceParentRelationID = (token.attrGet("sourceParent") ||
    undefined) as LongID | undefined;
  const rawSystemRole = token.attrGet("systemRole") || undefined;
  const systemRole =
    rawSystemRole === LOG_ROOT_ROLE ? LOG_ROOT_ROLE : undefined;
  const userPublicKey = (token.attrGet("userPublicKey") || undefined) as
    | PublicKey
    | undefined;
  const anchor =
    anchorContext ||
    anchorLabelsAttr ||
    sourceAuthor ||
    sourceRootID ||
    sourceRelationID ||
    sourceParentRelationID
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
          ...(sourceRelationID ? { sourceRelationID } : {}),
          ...(sourceParentRelationID ? { sourceParentRelationID } : {}),
        }
      : undefined;
  return {
    uuid,
    relevance,
    argument,
    hidden,
    basedOn,
    anchor,
    systemRole,
    userPublicKey,
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

  let pendingAttrs: {
    uuid: string | undefined;
    relevance: Relevance;
    argument: Argument;
    hidden: boolean;
    basedOn: string | undefined;
    anchor: RootAnchor | undefined;
    systemRole: RootSystemRole | undefined;
    userPublicKey: PublicKey | undefined;
  } = {
    uuid: undefined,
    relevance: undefined,
    argument: undefined,
    hidden: false,
    basedOn: undefined,
    anchor: undefined,
    systemRole: undefined,
    userPublicKey: undefined,
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
      const {
        uuid,
        relevance,
        argument,
        hidden,
        basedOn,
        anchor,
        systemRole,
        userPublicKey,
      } = extractAttrs(token);
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
        ...(uuid !== undefined && { uuid }),
        ...(relevance !== undefined && { relevance }),
        ...(argument !== undefined && { argument }),
        ...(hidden && { hidden }),
        ...(basedOn !== undefined && { basedOn }),
        ...(anchor !== undefined && { anchor }),
        ...(systemRole !== undefined && { systemRole }),
        ...(userPublicKey !== undefined && { userPublicKey }),
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
        const { uuid, relevance, argument, hidden, basedOn, userPublicKey } =
          pendingAttrs;
        const effectiveRelevance = linkRelevance ?? relevance;
        const effectiveArgument = linkArgument ?? argument;
        const node: MarkdownTreeNode = {
          text,
          children: [],
          blockKind: "list_item",
          ...(uuid !== undefined && { uuid }),
          ...(effectiveRelevance !== undefined && {
            relevance: effectiveRelevance,
          }),
          ...(effectiveArgument !== undefined && {
            argument: effectiveArgument,
          }),
          ...(linkHref !== undefined && { linkHref }),
          ...(hidden && { hidden }),
          ...(basedOn !== undefined && { basedOn }),
          ...(userPublicKey !== undefined && { userPublicKey }),
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
        ...(linkRelevance !== undefined && { relevance: linkRelevance }),
        ...(linkArgument !== undefined && { argument: linkArgument }),
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
