import {
  EMPTY_SEMANTIC_ID,
  getNode,
  getNodeText,
  getSemanticID,
} from "./core/connections";
import type { Document } from "./core/Document";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  getBlockFileLinkPath,
  getBlockFileLinkText,
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockFileLink,
  isBlockLink,
} from "./core/nodeSpans";
import {
  addBlankLinesAroundHeadings,
  formatBulletLine,
  formatHeadingLine,
  formatNodeAttrs,
  formatOrderedLine,
  formatPrefixMarkers,
  formatWithFrontMatter,
} from "./documentFormat";

type SerializeResult = {
  lines: string[];
};

function getSerializableNodeText(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string {
  return getNodeText(node) || getSemanticID(knowledgeDBs, node);
}

type SerializeReduceState = SerializeResult & {
  orderedCount: number;
  promoteToHeadingLevel?: number;
};

function getSerializableNodeBody(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  author: SourceId
): string | undefined {
  if (isBlockLink(node)) {
    const targetNodeID = getBlockLinkTarget(node);
    if (!targetNodeID) {
      return undefined;
    }
    const explicitLinkText = getBlockLinkText(node);
    const linkText =
      explicitLinkText ||
      buildOutgoingReference(node.id as ID, knowledgeDBs, author)?.text ||
      "";
    return `[${linkText}](#${targetNodeID})`;
  }
  if (isBlockFileLink(node)) {
    const linkPath = getBlockFileLinkPath(node);
    const linkText = getBlockFileLinkText(node) ?? "";
    return linkPath ? `[${linkText}](${linkPath})` : undefined;
  }
  return getSerializableNodeText(knowledgeDBs, node);
}

function getSerializableNodeAttrs(
  node: GraphNode,
  options?: { snapshotId?: string }
): string {
  const snapshotId =
    node.snapshotId ?? (node.basedOn ? options?.snapshotId : undefined);
  return formatNodeAttrs(node.id, {
    ...(node.basedOn ? { basedOn: node.basedOn } : {}),
    ...(snapshotId ? { snapshotId } : {}),
  });
}

function serializeNodeSequence(
  knowledgeDBs: KnowledgeDBs,
  author: SourceId,
  nodes: readonly GraphNode[],
  indent: string,
  current: SerializeResult,
  options?: {
    snapshotId?: string;
  }
): SerializeResult {
  const serializeChildren = (
    children: GraphNode["children"],
    childIndent: string,
    next: SerializeResult
  ): SerializeResult => {
    const childNodes = children
      .filter((childID) => childID !== EMPTY_SEMANTIC_ID)
      .map((childID) => {
        const child = getNode(knowledgeDBs, childID, author);
        if (!child) {
          throw new Error(`Missing child node: ${childID}`);
        }
        return child;
      })
      .toArray();
    return serializeNodeSequence(
      knowledgeDBs,
      author,
      childNodes,
      childIndent,
      next,
      options
    );
  };

  const result = nodes.reduce<SerializeReduceState>(
    (acc, item) => {
      const resolvedChild = item;
      const text = getSerializableNodeBody(knowledgeDBs, resolvedChild, author);
      if (text === undefined) {
        return acc;
      }
      const prefix = formatPrefixMarkers(item.relevance, item.argument);
      const attrs = getSerializableNodeAttrs(resolvedChild, options);

      if (resolvedChild.blockKind === "heading") {
        const level = resolvedChild.headingLevel ?? 2;
        const next: SerializeResult = {
          lines: [...acc.lines, formatHeadingLine(level, prefix, text, attrs)],
        };
        return {
          ...serializeChildren(resolvedChild.children, "", next),
          orderedCount: 0,
          promoteToHeadingLevel: level,
        };
      }

      if (resolvedChild.blockKind === "paragraph") {
        const next: SerializeResult = {
          lines: [...acc.lines, `${prefix}${text}${attrs}`],
        };
        return {
          ...serializeChildren(resolvedChild.children, "", next),
          orderedCount: 0,
        };
      }

      if (acc.promoteToHeadingLevel !== undefined) {
        const promotedLevel = acc.promoteToHeadingLevel;
        const next: SerializeResult = {
          lines: [
            ...acc.lines,
            formatHeadingLine(promotedLevel, prefix, text, attrs),
          ],
        };
        return {
          ...serializeChildren(resolvedChild.children, "", next),
          orderedCount: 0,
          promoteToHeadingLevel: promotedLevel,
        };
      }

      if (
        resolvedChild.blockKind === "list_item" &&
        resolvedChild.listOrdered === true
      ) {
        const number = (resolvedChild.listStart ?? 1) + acc.orderedCount;
        const childIndent = `${indent}${" ".repeat(String(number).length + 2)}`;
        const next: SerializeResult = {
          lines: [
            ...acc.lines,
            formatOrderedLine(indent, number, prefix, text, attrs),
          ],
        };
        return {
          ...serializeChildren(resolvedChild.children, childIndent, next),
          orderedCount: acc.orderedCount + 1,
        };
      }

      const next: SerializeResult = {
        lines: [...acc.lines, formatBulletLine(indent, prefix, text, attrs)],
      };
      return {
        ...serializeChildren(resolvedChild.children, `${indent}  `, next),
        orderedCount: 0,
      };
    },
    { ...current, orderedCount: 0 }
  );
  return { lines: result.lines };
}

export function renderRootedMarkdown(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  options?: {
    snapshotId?: string;
  }
): string {
  const serialized = serializeNodeSequence(
    knowledgeDBs,
    rootNode.author,
    [rootNode],
    "",
    { lines: [] },
    options
  );
  return `${addBlankLinesAroundHeadings(serialized.lines).join("\n")}\n`;
}

export function renderDocumentMarkdown(
  knowledgeDBs: KnowledgeDBs,
  document: Document,
  options?: {
    snapshotId?: string;
  }
): string {
  if (document.topNodeShortIds.length === 0) {
    return formatWithFrontMatter("", document.frontMatter);
  }
  const nodes = knowledgeDBs.get(document.author)?.nodes;
  const topNodes = document.topNodeShortIds
    .map((topNodeShortId) => nodes?.get(topNodeShortId))
    .filter((node): node is GraphNode => node !== undefined);
  if (topNodes.length === 0) {
    return formatWithFrontMatter("", document.frontMatter);
  }
  const serialized = serializeNodeSequence(
    knowledgeDBs,
    document.author,
    topNodes,
    "",
    { lines: [] },
    options
  );
  const markdown = addBlankLinesAroundHeadings(serialized.lines).join("\n");
  return formatWithFrontMatter(`${markdown}\n`, document.frontMatter);
}
