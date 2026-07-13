import { v4 } from "uuid";
import { LOCAL } from "./core/nodeRef";
import { getNode } from "./core/connections";
import {
  MarkdownImportFile,
  parseMarkdownImportFiles,
} from "./core/markdownImport";
import { materializeTree, WalkContext } from "./core/markdownNodes";
import { MarkdownTreeNode } from "./core/markdownTree";
import {
  GraphPlan,
  Plan,
  planAddTargetsToNode,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";
import { planUpsertRootDocument, withDocumentRoot } from "./core/plan";
import { newGraphNode } from "./core/nodeFactory";
import { plainSpans } from "./core/nodeSpans";

export function planCreateNodesFromMarkdownTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  options: { createDocuments?: boolean } = {}
): [T, topItemIDs: ID[], topNodeIDs: ID[]] {
  const createDocuments = options.createDocuments ?? true;
  const walkContext: WalkContext = {
    knowledgeDBs: plan.knowledgeDBs,
    sourceId: LOCAL,
    affectedDocuments: plan.affectedDocuments,
  };
  const treesWithDocIds = createDocuments
    ? trees.map((tree) => ({
        ...tree,
        docId: tree.docId ?? v4(),
      }))
    : trees;
  const result = materializeTree(treesWithDocIds, LOCAL, {
    context: walkContext,
  });
  const planWithNodes: T = {
    ...plan,
    knowledgeDBs: result.context.knowledgeDBs,
    affectedDocuments: result.context.affectedDocuments,
  };
  if (!createDocuments) {
    return [planWithNodes, result.topNodeIds, result.topNodeIds];
  }
  const userNodes = result.context.knowledgeDBs.get(LOCAL)?.nodes;
  const planWithDocs = result.topNodeIds.reduce<T>((acc, longId) => {
    const rootNode = userNodes?.get(longId);
    return rootNode ? planUpsertRootDocument(acc, rootNode) : acc;
  }, planWithNodes);
  return [planWithDocs, result.topNodeIds, result.topNodeIds];
}

export function planCreateNodesFromMarkdownFiles<T extends GraphPlan>(
  plan: T,
  files: MarkdownImportFile[]
): [T, topItemIDs: ID[]] {
  const trees = parseMarkdownImportFiles(files);
  const [nextPlan, topItemIDs] = planCreateNodesFromMarkdownTrees(plan, trees);
  return [nextPlan, topItemIDs];
}

export function planCreateNodesFromMarkdown<T extends GraphPlan>(
  plan: T,
  markdownText: string
): [T, topItemID: ID] {
  const [nextPlan, topItemIDs] = planCreateNodesFromMarkdownFiles(plan, [
    { name: "Imported Markdown", markdown: markdownText },
  ]);

  if (topItemIDs.length > 0) {
    return [nextPlan, topItemIDs[0] as ID];
  }

  const fallbackText = "Imported Markdown";
  const fallbackNode = withDocumentRoot(newGraphNode(plainSpans(fallbackText)));
  return [planUpsertNodes(nextPlan, fallbackNode), fallbackNode.id];
}

function moveCreatedTreesToParent<T extends GraphPlan>(
  plan: T,
  sourceNodeIDs: ID[],
  parentNode: GraphNode
): T {
  return sourceNodeIDs.reduce((accPlan, sourceNodeID) => {
    const sourceNode = sourceNodeID
      ? getNode(accPlan.knowledgeDBs, sourceNodeID, LOCAL)
      : undefined;
    if (!sourceNode) {
      return accPlan;
    }
    return planMoveDescendantNodes(
      accPlan,
      sourceNode,
      parentNode.id,
      parentNode.root
    );
  }, plan);
}

function planInsertMarkdownTreesByParentId<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  parentNodeId: ID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: T;
  topItemIDs: ID[];
  topNodeIDs: ID[];
  actualItemIDs: Array<ID>;
} {
  if (trees.length === 0) {
    return {
      plan,
      topItemIDs: [],
      topNodeIDs: [],
      actualItemIDs: [],
    };
  }

  const parentNode = getNode(plan.knowledgeDBs, parentNodeId, LOCAL);
  if (!parentNode) {
    return {
      plan,
      topItemIDs: [],
      topNodeIDs: [],
      actualItemIDs: [],
    };
  }

  const [planWithNodes, topItemIDs, topNodeIDs] =
    planCreateNodesFromMarkdownTrees(plan, trees, {
      createDocuments: false,
    });
  const movedPlan = moveCreatedTreesToParent(
    planWithNodes,
    topNodeIDs,
    parentNode
  );
  const [planWithAdded, actualItemIDs] = planAddTargetsToNode(
    movedPlan,
    parentNode.id,
    topNodeIDs,
    insertAtIndex,
    relevance,
    argument
  );

  return {
    plan: planWithAdded,
    topItemIDs,
    topNodeIDs,
    actualItemIDs,
  };
}

export function planInsertMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentNode: GraphNode,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: Plan;
  topItemIDs: ID[];
  topNodeIDs: ID[];
  actualItemIDs: Array<ID>;
} {
  return planInsertMarkdownTreesByParentId(
    plan,
    trees,
    parentNode.id,
    insertAtIndex,
    relevance,
    argument
  );
}
