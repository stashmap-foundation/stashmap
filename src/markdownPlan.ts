import { LOCAL, pathOf } from "./core/nodeRef";
import { getNode } from "./core/connections";
import {
  MarkdownImportFile,
  parseMarkdownImportFiles,
} from "./core/markdownImport";
import { materializeTree } from "./core/markdownNodes";
import { MarkdownTreeNode } from "./core/markdownTree";
import {
  GraphPlan,
  Plan,
  planAddTargetsToNode,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";
import { planUpsertRootDocument } from "./core/plan";
import { newGraphNode, newRowKey } from "./core/nodeFactory";
import { plainSpans, spansText } from "./core/nodeSpans";
import { newDocumentPath } from "./core/Document";

function planMaterializeTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  path: string
): [T, ID[]] {
  const result = materializeTree(trees, LOCAL, path, {
    context: {
      knowledgeDBs: plan.knowledgeDBs,
      sourceId: LOCAL,
      affectedDocuments: plan.affectedDocuments,
    },
  });
  return [
    {
      ...plan,
      knowledgeDBs: result.context.knowledgeDBs,
      affectedDocuments: result.context.affectedDocuments,
    },
    result.topNodeIds,
  ];
}

export function planCreateNodesFromMarkdownTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[]
): [T, topNodeIDs: ID[]] {
  return trees.reduce<[T, ID[]]>(
    ([accPlan, accIds], tree) => {
      const path = newDocumentPath(accPlan.documents, spansText(tree.spans));
      const [planWithNodes, [topNodeId]] = planMaterializeTrees(
        accPlan,
        [tree],
        path
      );
      const rootNode = getNode(planWithNodes.knowledgeDBs, topNodeId, LOCAL);
      return rootNode
        ? [
            planUpsertRootDocument(planWithNodes, rootNode),
            [...accIds, topNodeId],
          ]
        : [planWithNodes, accIds];
    },
    [plan, []]
  );
}

export function planCreateNodesFromMarkdownFiles<T extends GraphPlan>(
  plan: T,
  files: MarkdownImportFile[]
): [T, topItemIDs: ID[]] {
  return planCreateNodesFromMarkdownTrees(
    plan,
    parseMarkdownImportFiles(files)
  );
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
  const fallbackNode = newGraphNode(plainSpans(fallbackText), {
    id: newRowKey(newDocumentPath(nextPlan.documents, fallbackText)),
  });
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

  const [planWithNodes, topNodeIDs] = planMaterializeTrees(
    plan,
    trees,
    pathOf(parentNode.id)
  );
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
    topItemIDs: topNodeIDs,
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
