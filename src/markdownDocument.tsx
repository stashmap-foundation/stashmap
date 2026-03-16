/* eslint-disable functional/immutable-data */
import { List } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import {
  shortID,
  getNodeContext,
  getSemanticID,
  resolveNode,
  isRefNode,
} from "./connections";
import { getTextForSemanticID } from "./semanticProjection";
import {
  ViewPath,
  isRoot,
  getRowIDFromView,
  getDisplayTextForView,
  getCurrentEdgeForView,
  getNodeForView,
  getContext,
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  formatNodeAttrs,
  formatPrefixMarkers,
  formatRootHeading,
} from "./documentFormat";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { getNodesInTree } from "./treeTraversal";
import { createRootAnchor } from "./rootAnchor";
import { resolveSemanticNodeInCurrentTree } from "./semanticNavigation";

export type { MarkdownTreeNode } from "./markdownTree";
export { parseMarkdownHierarchy } from "./markdownTree";

function formatCrefText(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  refNode: GraphNode
): string | undefined {
  const { targetID } = refNode;
  if (!targetID) {
    return undefined;
  }
  const ref = buildOutgoingReference(
    refNode.id as LongID,
    knowledgeDBs,
    author
  );
  if (!ref) {
    return undefined;
  }
  const targetRelation = resolveNode(knowledgeDBs, refNode);
  const href = targetRelation ? `${targetRelation.id}` : `${targetID}`;
  return `[${ref.text}](#${href})`;
}

type SerializeResult = {
  lines: string[];
};

function getOwnRelationForDocumentSerialization(
  data: Data,
  path: ViewPath,
  stack: ID[],
  author: PublicKey,
  itemID: ID,
  semanticContext: List<ID>,
  rootNode: GraphNode,
  isRootNode: boolean
): GraphNode | undefined {
  const directRelation = getNodeForView(data, path, stack);
  if (directRelation) {
    return directRelation;
  }
  return resolveSemanticNodeInCurrentTree(
    data.knowledgeDBs,
    author,
    itemID,
    semanticContext,
    rootNode.id,
    isRootNode,
    rootNode.root
  );
}

function getSerializedRelationText(
  data: Data,
  relation: GraphNode
): { text: string } {
  if (relation.text !== "") {
    return {
      text: relation.text,
    };
  }

  const semanticID = getSemanticID(data.knowledgeDBs, relation);
  const fallbackText =
    getTextForSemanticID(data.knowledgeDBs, semanticID, relation.author) ??
    shortID(semanticID as ID);
  return {
    text: fallbackText,
  };
}

function buildRootPath(rootNode: GraphNode): ViewPath {
  return [0, rootNode.id];
}

function serializeTree(data: Data, rootNode: GraphNode): SerializeResult {
  const author = data.user.publicKey;
  const rootPath = buildRootPath(rootNode);
  const stack = [getSemanticID(data.knowledgeDBs, rootNode)];
  const { paths } = getNodesInTree(
    data,
    rootPath,
    stack,
    List<ViewPath>(),
    rootNode.id,
    author,
    undefined,
    { isMarkdownExport: true }
  );
  return paths.reduce<SerializeResult>(
    (acc, path) => {
      const depth = path.length - 3;
      const [itemID] = getRowIDFromView(data, path);
      const indent = "  ".repeat(depth);
      const semanticContext = getContext(data, path, stack);
      const item = getCurrentEdgeForView(data, path);

      if (isRefNode(item)) {
        const crefText = formatCrefText(data.knowledgeDBs, author, item);
        const { targetID } = item;
        if (!crefText || !targetID) return acc;
        const prefix = formatPrefixMarkers(item?.relevance, item?.argument);
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${prefix}${crefText}`],
        };
      }

      const ownRelation = getOwnRelationForDocumentSerialization(
        data,
        path,
        stack,
        author,
        itemID,
        semanticContext,
        rootNode,
        isRoot(path)
      );
      const serializedRelation = ownRelation
        ? getSerializedRelationText(data, ownRelation)
        : undefined;
      const text =
        serializedRelation?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();
      const prefix = formatPrefixMarkers(item?.relevance, item?.argument);

      const line = `${indent}- ${prefix}${text}${formatNodeAttrs(uuid, {
        basedOn: ownRelation?.basedOn,
        userPublicKey: ownRelation?.userPublicKey,
      })}`;
      return {
        lines: [...acc.lines, line],
      };
    },
    {
      lines: [],
    }
  );
}

export function buildDocumentEvent(
  data: Data,
  rootNode: GraphNode,
  options?: {
    snapshotDTag?: string;
  }
): UnsignedEvent {
  const author = data.user.publicKey;
  const rootContext = getNodeContext(data.knowledgeDBs, rootNode);
  const { text: rootText } = getSerializedRelationText(data, rootNode);
  const rootUuid = shortID(rootNode.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootNode.basedOn,
    options?.snapshotDTag ?? rootNode.snapshotDTag,
    rootNode.anchor ?? createRootAnchor(rootContext),
    rootNode.systemRole
  );
  const result = serializeTree(data, rootNode);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const systemRoleTags = rootNode.systemRole
    ? ([["s", rootNode.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...systemRoleTags, msTag()],
    content,
  };
}
