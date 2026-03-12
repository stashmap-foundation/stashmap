import { UnsignedEvent } from "nostr-tools";
import { shortID } from "./connections";
import {
  buildKnowledgeDocumentEvents,
  createHeadlessPlan,
} from "./core/headlessPlan";
import { MarkdownImportFile, parseMarkdownImportFiles } from "./markdownImport";
import { planCreateNodesFromMarkdownTrees } from "./markdownPlan";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { KIND_KNOWLEDGE_DOCUMENT } from "./nostr";

export function requireSingleRootMarkdownTree(
  markdown: string,
  errorMessage = "stdin markdown must resolve to exactly one top-level root"
): MarkdownTreeNode {
  const roots = parseMarkdownHierarchy(markdown).filter((root) => !root.hidden);
  const rootTree = roots[0];
  if (!rootTree || roots.length !== 1) {
    throw new Error(errorMessage);
  }
  return rootTree;
}

function buildDocumentEventFromRootTree(
  author: PublicKey,
  rootTree: MarkdownTreeNode
): {
  relationID: LongID;
  rootUuid: string;
  event: UnsignedEvent;
} {
  const [planWithRoot, , topRelationIds] = planCreateNodesFromMarkdownTrees(
    createHeadlessPlan(author),
    [rootTree]
  );
  const relationID = topRelationIds[0];
  if (!relationID) {
    throw new Error("Markdown upload must resolve to exactly one root tree");
  }
  const relation = planWithRoot.knowledgeDBs
    .get(author)
    ?.relations.get(shortID(relationID));
  if (!relation) {
    throw new Error(`Created relation not found: ${relationID}`);
  }
  const event = buildKnowledgeDocumentEvents(planWithRoot).find(
    (candidate) => candidate.kind === KIND_KNOWLEDGE_DOCUMENT
  );
  if (!event) {
    throw new Error(`Document event not built for relation: ${relationID}`);
  }
  return {
    relationID,
    rootUuid: shortID(relationID),
    event,
  };
}

export function buildStandaloneRootDocumentEvent(
  author: PublicKey,
  title: string,
  systemRole?: RootSystemRole
): {
  relationID: LongID;
  rootUuid: string;
  event: UnsignedEvent;
} {
  return buildDocumentEventFromRootTree(author, {
    text: title,
    children: [],
    ...(systemRole ? { systemRole } : {}),
  });
}

export function buildImportedMarkdownDocumentEvent(
  author: PublicKey,
  file: MarkdownImportFile
): {
  relationID: LongID;
  rootUuid: string;
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
  event: UnsignedEvent;
} {
  return buildDocumentEventFromRootTree(
    author,
    requireSingleRootMarkdownTree(markdown)
  );
}
