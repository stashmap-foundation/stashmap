import { EMPTY_NODE_ID, getNode } from "./core/connections";
import type { Document } from "./core/Document";
import { spansToMarkdown } from "./core/nodeSpans";
import { rowIdOf } from "./core/nodeRef";
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

type SerializeReduceState = SerializeResult & {
  orderedCount: number;
  promoteToHeadingLevel?: number;
};

function isEmbedRow(node: GraphNode): boolean {
  return (
    node.extraAttrs?.embed === "true" &&
    node.spans.length === 1 &&
    node.spans[0]?.kind === "link"
  );
}

function getSerializableNodeBody(node: GraphNode): string | undefined {
  const body = spansToMarkdown(node.spans);
  if (body === "") return undefined;
  return isEmbedRow(node) ? `!${body}` : body;
}

function getSerializableNodeAttrs(node: GraphNode): string {
  return formatNodeAttrs(rowIdOf(node.id), {
    extraAttrs: Object.fromEntries(
      Object.entries(node.extraAttrs ?? {}).filter(([key]) => key !== "embed")
    ),
  });
}

function serializeNodeSequence(
  knowledgeDBs: KnowledgeDBs,
  author: SourceId,
  nodes: readonly GraphNode[],
  indent: string,
  current: SerializeResult
): SerializeResult {
  const serializeChildren = (
    children: GraphNode["children"],
    childIndent: string,
    next: SerializeResult
  ): SerializeResult => {
    const childNodes = children
      .filter((childID) => childID !== EMPTY_NODE_ID)
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
      next
    );
  };

  const result = nodes.reduce<SerializeReduceState>(
    (acc, item) => {
      const resolvedChild = item;
      const text = getSerializableNodeBody(resolvedChild);
      if (text === undefined) {
        return acc;
      }
      const prefix = formatPrefixMarkers(item.relevance, item.argument);
      const attrs = getSerializableNodeAttrs(resolvedChild);

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

export function renderDocumentMarkdown(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): string {
  if (document.topNodeShortIds.length === 0) {
    return formatWithFrontMatter("", document.frontMatter);
  }
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  const topNodes = document.topNodeShortIds
    .map((topNodeShortId) => nodes?.get(topNodeShortId))
    .filter((node): node is GraphNode => node !== undefined);
  if (topNodes.length === 0) {
    return formatWithFrontMatter("", document.frontMatter);
  }
  const serialized = serializeNodeSequence(
    knowledgeDBs,
    document.sourceId,
    topNodes,
    "",
    { lines: [] }
  );
  const markdown = addBlankLinesAroundHeadings(serialized.lines).join("\n");
  return formatWithFrontMatter(`${markdown}\n`, document.frontMatter);
}
