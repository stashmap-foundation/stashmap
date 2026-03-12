/* eslint-disable functional/immutable-data */
import { List, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import {
  shortID,
  hashText,
  isConcreteRefId,
  parseConcreteRefId,
  getConcreteRefTargetRelation,
  getRelationContext,
  getRelationSemanticID,
} from "./connections";
import { getTextForSemanticID } from "./semanticProjection";
import {
  ViewPath,
  isRoot,
  getRowIDFromView,
  getDisplayTextForView,
  getCurrentEdgeForView,
  getRelationForView,
  getContext,
} from "./ViewContext";
import { buildOutgoingReference } from "./buildReferenceRow";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { KIND_KNOWLEDGE_DOCUMENT, newTimestamp, msTag } from "./nostr";
import { getNodesInTree } from "./treeTraversal";
import { createRootAnchor } from "./rootAnchor";
import { resolveSemanticRelationInCurrentTree } from "./semanticNavigation";

export {
  createNodesFromMarkdownTrees,
  parseDocumentEvent,
  type WalkContext,
} from "./markdownRelations";

export type { MarkdownTreeNode } from "./markdownTree";
export { parseMarkdownHierarchy } from "./markdownTree";

function formatCrefText(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  refID: LongID | ID
): string | undefined {
  const parsed = parseConcreteRefId(refID);
  if (!parsed) {
    return undefined;
  }
  const ref = buildOutgoingReference(refID as LongID, knowledgeDBs, author);
  if (!ref) {
    return undefined;
  }
  const targetRelation = getConcreteRefTargetRelation(
    knowledgeDBs,
    refID,
    author
  );
  const href = targetRelation ? `${targetRelation.id}` : `${parsed.relationID}`;
  return `[${ref.text}](#${href})`;
}

type SerializeResult = {
  lines: string[];
  relationUUIDs: ImmutableSet<string>;
};

function getOwnRelationForDocumentSerialization(
  data: Data,
  path: ViewPath,
  stack: ID[],
  author: PublicKey,
  itemID: LongID | ID,
  semanticContext: List<ID>,
  rootRelation: Relations,
  isRootNode: boolean
): Relations | undefined {
  const directRelation = getRelationForView(data, path, stack);
  if (directRelation) {
    return directRelation;
  }
  return resolveSemanticRelationInCurrentTree(
    data.knowledgeDBs,
    author,
    itemID,
    semanticContext,
    rootRelation.id,
    isRootNode,
    rootRelation.root
  );
}

function getSerializedRelationText(
  data: Data,
  relation: Relations,
  semanticID: LongID | ID
): { text: string; textHash: ID } {
  if (relation.text !== "") {
    return {
      text: relation.text,
      textHash: relation.textHash,
    };
  }

  const fallbackText =
    getTextForSemanticID(data.knowledgeDBs, semanticID, relation.author) ??
    shortID(semanticID as ID);
  return {
    text: fallbackText,
    textHash: hashText(fallbackText),
  };
}

function buildRootPath(rootRelation: Relations): ViewPath {
  return [0, rootRelation.id];
}

function serializeTree(data: Data, rootRelation: Relations): SerializeResult {
  const author = data.user.publicKey;
  const rootPath = buildRootPath(rootRelation);
  const stack = [getRelationSemanticID(rootRelation)];
  const { paths } = getNodesInTree(
    data,
    rootPath,
    stack,
    List<ViewPath>(),
    rootRelation.id,
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

      if (isConcreteRefId(itemID)) {
        const parsed = parseConcreteRefId(itemID);
        const crefText = formatCrefText(data.knowledgeDBs, author, itemID);
        if (!crefText || !parsed) return acc;
        const targetRelation = getConcreteRefTargetRelation(
          data.knowledgeDBs,
          itemID,
          author
        );
        const crefRelationUUID = shortID(
          (targetRelation?.id || parsed.relationID) as ID
        );
        const crefAttrs = formatNodeAttrs("", item?.relevance, item?.argument);
        return {
          ...acc,
          lines: [...acc.lines, `${indent}- ${crefText}${crefAttrs}`],
          relationUUIDs: acc.relationUUIDs.add(crefRelationUUID),
        };
      }

      const ownRelation = getOwnRelationForDocumentSerialization(
        data,
        path,
        stack,
        author,
        itemID,
        semanticContext,
        rootRelation,
        isRoot(path)
      );
      const serializedRelation = ownRelation
        ? getSerializedRelationText(
            data,
            ownRelation,
            getRelationSemanticID(ownRelation)
          )
        : undefined;
      const serializedSemanticID = ownRelation
        ? getRelationSemanticID(ownRelation)
        : (shortID(itemID as ID) as ID);
      const text =
        serializedRelation?.text ?? getDisplayTextForView(data, path, stack);
      const uuid = ownRelation ? shortID(ownRelation.id) : v4();

      const line = `${indent}- ${text}${formatNodeAttrs(
        uuid,
        item?.relevance,
        item?.argument,
        {
          basedOn: ownRelation?.basedOn,
          semanticID: serializedSemanticID,
          userPublicKey: ownRelation?.userPublicKey,
        }
      )}`;
      return {
        lines: [...acc.lines, line],
        relationUUIDs: acc.relationUUIDs.add(uuid),
      };
    },
    {
      lines: [],
      relationUUIDs: ImmutableSet<string>(),
    }
  );
}

export function treeToMarkdown(data: Data, rootRelation: Relations): string {
  const rootContext = getRelationContext(data.knowledgeDBs, rootRelation);
  const rootSemanticID = getRelationSemanticID(rootRelation);
  const { text: rootText } = getSerializedRelationText(
    data,
    rootRelation,
    rootSemanticID
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootSemanticID,
    rootRelation.anchor ?? createRootAnchor(rootContext),
    rootRelation.systemRole
  );
  const { lines } = serializeTree(data, rootRelation);
  return `${[rootLine, ...lines].join("\n")}\n`;
}

export function buildDocumentEvent(
  data: Data,
  rootRelation: Relations
): UnsignedEvent {
  const author = data.user.publicKey;
  const rootContext = getRelationContext(data.knowledgeDBs, rootRelation);
  const rootSemanticID = getRelationSemanticID(rootRelation);
  const { text: rootText } = getSerializedRelationText(
    data,
    rootRelation,
    rootSemanticID
  );
  const rootUuid = shortID(rootRelation.id);
  const rootLine = formatRootHeading(
    rootText,
    rootUuid,
    rootSemanticID,
    rootRelation.anchor ?? createRootAnchor(rootContext),
    rootRelation.systemRole
  );
  const result = serializeTree(data, rootRelation);
  const content = `${[rootLine, ...result.lines].join("\n")}\n`;
  const rTags = result.relationUUIDs
    .add(rootUuid)
    .toArray()
    .map((u) => ["r", u]);
  const systemRoleTags = rootRelation.systemRole
    ? ([["s", rootRelation.systemRole]] as string[][])
    : [];

  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: author,
    created_at: newTimestamp(),
    tags: [["d", rootUuid], ...rTags, ...systemRoleTags, msTag()],
    content,
  };
}
