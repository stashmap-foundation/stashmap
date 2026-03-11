import crypto from "crypto";
import { v4 } from "uuid";
import { UnsignedEvent } from "nostr-tools";
import { formatNodeAttrs, formatRootHeading } from "./documentFormat";
import { MarkdownImportFile, parseMarkdownImportFiles } from "./markdownImport";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { KIND_KNOWLEDGE_DOCUMENT, msTag, newTimestamp } from "./nostr";

function hashText(text: string): ID {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex")
    .slice(0, 32) as ID;
}

function joinID(author: PublicKey, localID: string): LongID {
  return `${author}_${localID}` as LongID;
}

type SerializedTree = {
  lines: string[];
  nodeHashes: Set<string>;
  semanticIDs: Set<string>;
  relationUUIDs: Set<string>;
};

function getNodeSemanticID(node: MarkdownTreeNode): ID {
  return node.semanticID ?? hashText(node.text);
}

function getNodeUuid(node: MarkdownTreeNode): string {
  return node.uuid ?? v4();
}

function getLinkRelationUuid(linkHref: string): string | undefined {
  const relationID = linkHref.split(":")[0];
  if (!relationID) {
    return undefined;
  }
  return relationID.includes("_")
    ? relationID.split("_").slice(1).join("_")
    : relationID;
}

function serializeNodes(
  children: MarkdownTreeNode[],
  depth: number,
  current: SerializedTree
): SerializedTree {
  return children.reduce((acc, node) => {
    if (node.hidden) {
      return acc;
    }

    const indent = "  ".repeat(depth);
    if (node.linkHref) {
      const relationUuid = getLinkRelationUuid(node.linkHref);
      const next: SerializedTree = {
        ...acc,
        lines: [
          ...acc.lines,
          `${indent}- [${node.text}](#${node.linkHref})${formatNodeAttrs(
            node.uuid ?? "",
            node.relevance,
            node.argument,
            {
              ...(node.semanticID ? { semanticID: node.semanticID } : {}),
              ...(node.basedOn ? { basedOn: node.basedOn as LongID } : {}),
            }
          )}`,
        ],
        relationUUIDs: relationUuid
          ? acc.relationUUIDs.add(relationUuid)
          : acc.relationUUIDs,
      };
      return serializeNodes(node.children, depth + 1, next);
    }

    const uuid = getNodeUuid(node);
    const semanticID = getNodeSemanticID(node);
    const next: SerializedTree = {
      lines: [
        ...acc.lines,
        `${indent}- ${node.text}${formatNodeAttrs(
          uuid,
          node.relevance,
          node.argument,
          {
            semanticID,
            ...(node.basedOn ? { basedOn: node.basedOn as LongID } : {}),
          }
        )}`,
      ],
      nodeHashes: acc.nodeHashes.add(hashText(node.text)),
      semanticIDs: acc.semanticIDs.add(semanticID),
      relationUUIDs: acc.relationUUIDs.add(uuid),
    };
    return serializeNodes(node.children, depth + 1, next);
  }, current);
}

function buildDocumentEventFromRootTree(
  author: PublicKey,
  rootTree: MarkdownTreeNode
): {
  relationID: LongID;
  rootUuid: string;
  semanticID: ID;
  event: UnsignedEvent;
} {
  const rootUuid = getNodeUuid(rootTree);
  const semanticID = getNodeSemanticID(rootTree);
  const rootTextHash = hashText(rootTree.text);
  const serialized = serializeNodes(rootTree.children, 0, {
    lines: [],
    nodeHashes: new Set<string>(),
    semanticIDs: new Set<string>(),
    relationUUIDs: new Set<string>(),
  });
  const tagValues = new Set([
    rootTextHash,
    semanticID,
    ...serialized.nodeHashes,
    ...serialized.semanticIDs,
  ]);
  const nTags = [...tagValues].map((value) => ["n", value]);
  const rTags = [...serialized.relationUUIDs.add(rootUuid)].map((value) => [
    "r",
    value,
  ]);
  const systemRoleTags = rootTree.systemRole
    ? ([["s", rootTree.systemRole]] as string[][])
    : [];

  return {
    relationID: joinID(author, rootUuid),
    rootUuid,
    semanticID,
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: author,
      created_at: newTimestamp(),
      tags: [["d", rootUuid], ...nTags, ...rTags, ...systemRoleTags, msTag()],
      content: `${[
        formatRootHeading(
          rootTree.text,
          rootUuid,
          semanticID,
          rootTree.anchor,
          rootTree.systemRole
        ),
        ...serialized.lines,
      ].join("\n")}\n`,
    },
  };
}

export function buildStandaloneRootDocumentEvent(
  author: PublicKey,
  title: string,
  systemRole?: RootSystemRole
): {
  relationID: LongID;
  rootUuid: string;
  semanticID: ID;
  event: UnsignedEvent;
} {
  return buildDocumentEventFromRootTree(author, {
    text: title,
    children: [],
    semanticID: hashText(title),
    ...(systemRole ? { systemRole } : {}),
  });
}

export function buildImportedMarkdownDocumentEvent(
  author: PublicKey,
  file: MarkdownImportFile
): {
  relationID: LongID;
  rootUuid: string;
  semanticID: ID;
  event: UnsignedEvent;
} {
  const roots = parseMarkdownImportFiles([file]).filter((root) => !root.hidden);
  const rootTree = roots[0];
  if (!rootTree || roots.length !== 1) {
    throw new Error("Markdown upload must resolve to exactly one root tree");
  }
  return buildDocumentEventFromRootTree(author, rootTree);
}

export function buildSingleRootMarkdownDocumentEvent(
  author: PublicKey,
  markdown: string
): {
  relationID: LongID;
  rootUuid: string;
  semanticID: ID;
  event: UnsignedEvent;
} {
  const roots = parseMarkdownHierarchy(markdown).filter((root) => !root.hidden);
  const rootTree = roots[0];
  if (!rootTree || roots.length !== 1) {
    throw new Error(
      "stdin markdown must resolve to exactly one top-level root"
    );
  }
  return buildDocumentEventFromRootTree(author, rootTree);
}
