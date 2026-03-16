import { UnsignedEvent } from "nostr-tools";
import { shortID } from "./connections";
import { createHeadlessPlan } from "./core/headlessPlan";
import { planCreateNodesFromMarkdownTrees } from "./markdownPlan";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { buildDocumentEventFromNodes } from "./relationsDocumentEvent";

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
    ?.nodes.get(shortID(relationID));
  if (!relation) {
    throw new Error(`Created relation not found: ${relationID}`);
  }
  return {
    relationID,
    rootUuid: shortID(relationID),
    event: buildDocumentEventFromNodes(planWithRoot.knowledgeDBs, relation),
  };
}

export function buildDocumentEventFromMarkdownTree(
  author: PublicKey,
  rootTree: MarkdownTreeNode
): {
  relationID: LongID;
  rootUuid: string;
  event: UnsignedEvent;
} {
  return buildDocumentEventFromRootTree(author, rootTree);
}
