import { UnsignedEvent } from "nostr-tools";
import {
  EMPTY_SEMANTIC_ID,
  getNodeContext,
  getSemanticID,
  getNodeText,
  getNode,
  resolveNode,
  isRefNode,
  shortID,
} from "./connections";
import {
  formatBulletLine,
  formatHeadingLine,
  formatNodeAttrs,
  formatOrderedLine,
  formatPrefixMarkers,
  formatRootHeading,
  formatWithFrontMatter,
} from "./documentFormat";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  msTag,
  newTimestamp,
} from "./nostr";
import { createRootAnchor } from "./rootAnchor";

type SerializeResult = {
  lines: string[];
};

const HEADING_LINE_RE = /^#{1,6} /;

function addBlankLinesAroundHeadings(lines: string[]): string[] {
  return lines.reduce<string[]>((acc, line, index) => {
    const isHeading = HEADING_LINE_RE.test(line);
    const prevLine = acc.length > 0 ? acc[acc.length - 1] : undefined;
    const prevIsHeading =
      prevLine !== undefined && HEADING_LINE_RE.test(prevLine);
    const needsBlankBefore = isHeading && index > 0 && prevLine !== "";
    const needsBlankAfterPrev = prevIsHeading && !isHeading && prevLine !== "";
    if (needsBlankBefore || needsBlankAfterPrev) {
      return [...acc, "", line];
    }
    return [...acc, line];
  }, []);
}

function getSerializableNodeText(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string {
  return getNodeText(node) || shortID(getSemanticID(knowledgeDBs, node));
}

function serializeNodeItems(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  children: GraphNode["children"],
  indent: string,
  current: SerializeResult
): SerializeResult {
  return children.reduce((acc, childID, index) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return acc;
    }
    const item = getNode(knowledgeDBs, childID, author);
    if (!item) {
      throw new Error(`Missing child node: ${childID}`);
    }
    if (isRefNode(item)) {
      const targetNode = resolveNode(knowledgeDBs, item);
      const targetNodeID = item.targetID;
      if (!targetNodeID) {
        return acc;
      }
      const linkText =
        item.linkText ||
        (targetNode ? getSerializableNodeText(knowledgeDBs, targetNode) : "") ||
        shortID(targetNodeID);
      const prefix = formatPrefixMarkers(item.relevance, item.argument);
      return {
        ...acc,
        lines: [
          ...acc.lines,
          `${indent}- ${prefix}[${linkText}](#${targetNodeID})`,
        ],
      };
    }

    const resolvedChild = item;
    const text = getSerializableNodeText(knowledgeDBs, resolvedChild);
    const prefix = formatPrefixMarkers(item.relevance, item.argument);
    const attrs = formatNodeAttrs(shortID(resolvedChild.id), {
      ...(resolvedChild.basedOn ? { basedOn: resolvedChild.basedOn } : {}),
      ...(resolvedChild.userPublicKey
        ? { userPublicKey: resolvedChild.userPublicKey }
        : {}),
    });

    if (resolvedChild.blockKind === "heading") {
      const level = resolvedChild.headingLevel ?? 2;
      const next: SerializeResult = {
        lines: [...acc.lines, formatHeadingLine(level, prefix, text, attrs)],
      };
      return serializeNodeItems(
        knowledgeDBs,
        author,
        resolvedChild.children,
        "",
        next
      );
    }

    if (
      resolvedChild.blockKind === "list_item" &&
      resolvedChild.listOrdered === true
    ) {
      const number = (resolvedChild.listStart ?? 1) + index;
      const childIndent = `${indent}${" ".repeat(String(number).length + 2)}`;
      const next: SerializeResult = {
        lines: [
          ...acc.lines,
          formatOrderedLine(indent, number, prefix, text, attrs),
        ],
      };
      return serializeNodeItems(
        knowledgeDBs,
        author,
        resolvedChild.children,
        childIndent,
        next
      );
    }

    const next: SerializeResult = {
      lines: [...acc.lines, formatBulletLine(indent, prefix, text, attrs)],
    };
    return serializeNodeItems(
      knowledgeDBs,
      author,
      resolvedChild.children,
      `${indent}  `,
      next
    );
  }, current);
}

export function buildDocumentEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  options?: {
    snapshotDTag?: string;
  }
): UnsignedEvent {
  const rootText = getSerializableNodeText(knowledgeDBs, rootNode);
  const rootUuid = shortID(rootNode.id);
  const serialized = serializeNodeItems(
    knowledgeDBs,
    rootNode.author,
    rootNode.children,
    "",
    {
      lines: [],
    }
  );
  const systemRoleTags = rootNode.systemRole
    ? ([["s", rootNode.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: rootNode.author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...systemRoleTags, msTag()],
    content: formatWithFrontMatter(
      `${addBlankLinesAroundHeadings([
        formatRootHeading(
          rootText,
          rootUuid,
          rootNode.basedOn,
          options?.snapshotDTag ?? rootNode.snapshotDTag,
          rootNode.anchor ??
            createRootAnchor(getNodeContext(knowledgeDBs, rootNode)),
          rootNode.systemRole
        ),
        ...serialized.lines,
      ]).join("\n")}\n`,
      rootNode.frontMatter
    ),
  };
}

export function buildSnapshotEventFromNodes(
  knowledgeDBs: KnowledgeDBs,
  snapshotAuthor: PublicKey,
  snapshotDTag: string,
  sourceRootNode: GraphNode
): UnsignedEvent {
  const snapshotContent = buildDocumentEventFromNodes(
    knowledgeDBs,
    sourceRootNode
  ).content;
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    pubkey: snapshotAuthor,
    created_at: newTimestamp(),
    tags: [
      ["d", snapshotDTag],
      ["source", shortID(sourceRootNode.id)],
      ["source_author", sourceRootNode.author],
      msTag(),
    ],
    content: snapshotContent,
  };
}
