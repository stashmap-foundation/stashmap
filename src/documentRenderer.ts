import {
  EMPTY_SEMANTIC_ID,
  getNode,
  getNodeContext,
  getNodeText,
  getSemanticID,
  isRefNode,
  shortID,
} from "./connections";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  addBlankLinesAroundHeadings,
  formatBulletLine,
  formatHeadingLine,
  formatNodeAttrs,
  formatOrderedLine,
  formatPrefixMarkers,
  formatRootHeading,
  formatWithFrontMatter,
} from "./documentFormat";
import { createRootAnchor } from "./rootAnchor";

type SerializeResult = {
  lines: string[];
};

function getSerializableNodeText(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string {
  return getNodeText(node) || shortID(getSemanticID(knowledgeDBs, node));
}

type SerializeReduceState = SerializeResult & {
  orderedCount: number;
  promoteToHeadingLevel?: number;
};

function serializeNodeItems(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  children: GraphNode["children"],
  indent: string,
  current: SerializeResult
): SerializeResult {
  const result = children.reduce<SerializeReduceState>(
    (acc, childID) => {
      if (childID === EMPTY_SEMANTIC_ID) {
        return acc;
      }
      const item = getNode(knowledgeDBs, childID, author);
      if (!item) {
        throw new Error(`Missing child node: ${childID}`);
      }
      if (isRefNode(item)) {
        const targetNodeID = item.targetID;
        if (!targetNodeID) {
          return acc;
        }
        const ref = buildOutgoingReference(
          item.id as LongID,
          knowledgeDBs,
          author
        );
        if (!ref) {
          return acc;
        }
        const linkText = item.linkText || ref.text;
        const prefix = formatPrefixMarkers(item.relevance, item.argument);
        const body = `${prefix}[${linkText}](#${targetNodeID})`;
        const line =
          acc.promoteToHeadingLevel !== undefined
            ? `${"#".repeat(acc.promoteToHeadingLevel)} ${body}`
            : `${indent}- ${body}`;
        return {
          ...acc,
          orderedCount: 0,
          lines: [...acc.lines, line],
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
        return {
          ...serializeNodeItems(
            knowledgeDBs,
            author,
            resolvedChild.children,
            "",
            next
          ),
          orderedCount: 0,
          promoteToHeadingLevel: level,
        };
      }

      if (resolvedChild.blockKind === "paragraph") {
        const next: SerializeResult = {
          lines: [...acc.lines, `${prefix}${text}${attrs}`],
        };
        return {
          ...serializeNodeItems(
            knowledgeDBs,
            author,
            resolvedChild.children,
            "",
            next
          ),
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
          ...serializeNodeItems(
            knowledgeDBs,
            author,
            resolvedChild.children,
            "",
            next
          ),
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
          ...serializeNodeItems(
            knowledgeDBs,
            author,
            resolvedChild.children,
            childIndent,
            next
          ),
          orderedCount: acc.orderedCount + 1,
        };
      }

      const next: SerializeResult = {
        lines: [...acc.lines, formatBulletLine(indent, prefix, text, attrs)],
      };
      return {
        ...serializeNodeItems(
          knowledgeDBs,
          author,
          resolvedChild.children,
          `${indent}  `,
          next
        ),
        orderedCount: 0,
      };
    },
    { ...current, orderedCount: 0 }
  );
  return { lines: result.lines };
}

export function renderDocumentMarkdown(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  options?: {
    snapshotDTag?: string;
  }
): string {
  const rootText = getSerializableNodeText(knowledgeDBs, rootNode);
  const rootUuid = shortID(rootNode.id);
  const serialized = serializeNodeItems(
    knowledgeDBs,
    rootNode.author,
    rootNode.children,
    "",
    { lines: [] }
  );
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootNode.basedOn,
    options?.snapshotDTag ?? rootNode.snapshotDTag,
    rootNode.anchor ?? createRootAnchor(getNodeContext(knowledgeDBs, rootNode)),
    rootNode.systemRole
  );
  return formatWithFrontMatter(
    `${addBlankLinesAroundHeadings([rootLine, ...serialized.lines]).join(
      "\n"
    )}\n`,
    rootNode.frontMatter
  );
}
