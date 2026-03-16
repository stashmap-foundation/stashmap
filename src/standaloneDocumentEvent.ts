import { UnsignedEvent } from "nostr-tools";
import { shortID } from "./connections";
import { createHeadlessPlan } from "./core/headlessPlan";
import { planCreateNodesFromMarkdownTrees } from "./markdownPlan";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { buildDocumentEventFromNodes } from "./nodesDocumentEvent";

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
  nodeID: LongID;
  rootUuid: string;
  event: UnsignedEvent;
} {
  const [planWithRoot, , topNodeIds] = planCreateNodesFromMarkdownTrees(
    createHeadlessPlan(author),
    [rootTree]
  );
  const nodeID = topNodeIds[0];
  if (!nodeID) {
    throw new Error("Markdown upload must resolve to exactly one root tree");
  }
  const node = planWithRoot.knowledgeDBs
    .get(author)
    ?.nodes.get(shortID(nodeID));
  if (!node) {
    throw new Error(`Created node not found: ${nodeID}`);
  }
  return {
    nodeID,
    rootUuid: shortID(nodeID),
    event: buildDocumentEventFromNodes(planWithRoot.knowledgeDBs, node),
  };
}

export function buildDocumentEventFromMarkdownTree(
  author: PublicKey,
  rootTree: MarkdownTreeNode
): {
  nodeID: LongID;
  rootUuid: string;
  event: UnsignedEvent;
} {
  return buildDocumentEventFromRootTree(author, rootTree);
}
