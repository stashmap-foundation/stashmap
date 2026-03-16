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
  RowPath,
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
  const targetNode = resolveNode(knowledgeDBs, refNode);
  const href = targetNode ? `${targetNode.id}` : `${targetID}`;
  return `[${ref.text}](#${href})`;
}

type SerializeResult = {
  lines: string[];
};

function getOwnNodeForDocumentSerialization(
  data: Data,
  path: RowPath,
  stack: ID[],
  author: PublicKey,
  itemID: ID,
  semanticContext: List<ID>,
  rootNode: GraphNode,
  isRootNode: boolean
): GraphNode | undefined {
  const directNode = getNodeForView(data, path, stack);
  if (directNode) {
    return directNode;
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

function getSerializedNodeText(data: Data, node: GraphNode): { text: string } {
  if (node.text !== "") {
    return {
      text: node.text,
    };
  }

  const semanticID = getSemanticID(data.knowledgeDBs, node);
  const fallbackText =
    getTextForSemanticID(data.knowledgeDBs, semanticID, node.author) ??
    shortID(semanticID as ID);
  return {
    text: fallbackText,
  };
}

function buildRootPath(rootNode: GraphNode): RowPath {
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
    List<RowPath>(),
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

      const ownNode = getOwnNodeForDocumentSerialization(
        data,
        path,
        stack,
        author,
        itemID,
        semanticContext,
        rootNode,
        isRoot(path)
      );
      const serializedNode = ownNode
        ? getSerializedNodeText(data, ownNode)
        : undefined;
      const text =
        serializedNode?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownNode ? shortID(ownNode.id) : v4();
      const prefix = formatPrefixMarkers(item?.relevance, item?.argument);

      const line = `${indent}- ${prefix}${text}${formatNodeAttrs(uuid, {
        basedOn: ownNode?.basedOn,
        userPublicKey: ownNode?.userPublicKey,
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
  const { text: rootText } = getSerializedNodeText(data, rootNode);
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
