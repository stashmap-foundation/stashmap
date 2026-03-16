import { List } from "immutable";
import { getNodeContext, getSemanticID, getNode, shortID } from "./connections";
import { MarkdownImportFile, parseMarkdownImportFiles } from "./markdownImport";
import { createNodesFromMarkdownTrees, WalkContext } from "./markdownNodes";
import { MarkdownTreeNode } from "./markdownTree";
import {
  AddToParentTarget,
  GraphPlan,
  Plan,
  planAddTargetsToNode,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";
import { newNode } from "./nodeFactory";
import { getNodeForView } from "./rows/resolveRow";
import { type RowPath } from "./rows/rowPaths";

export function planCreateNodesFromMarkdownTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [T, topItemIDs: ID[], topNodeIDs: LongID[]] {
  const walkContext: WalkContext = {
    knowledgeDBs: plan.knowledgeDBs,
    publicKey: plan.user.publicKey,
    affectedRoots: plan.affectedRoots,
  };
  const [resultContext, topItemIDs, topNodeIDs] = createNodesFromMarkdownTrees(
    walkContext,
    trees,
    context
  );
  return [
    {
      ...plan,
      knowledgeDBs: resultContext.knowledgeDBs,
      affectedRoots: resultContext.affectedRoots,
    },
    topItemIDs,
    topNodeIDs,
  ];
}

export function planCreateNodesFromMarkdownFiles<T extends GraphPlan>(
  plan: T,
  files: MarkdownImportFile[],
  context: List<ID> = List<ID>()
): [T, topItemIDs: ID[]] {
  const trees = parseMarkdownImportFiles(files);
  const [nextPlan, topItemIDs] = planCreateNodesFromMarkdownTrees(
    plan,
    trees,
    context
  );
  return [nextPlan, topItemIDs];
}

export function planCreateNodesFromMarkdown<T extends GraphPlan>(
  plan: T,
  markdownText: string,
  context: List<ID> = List<ID>()
): [T, topItemID: ID] {
  const [nextPlan, topItemIDs] = planCreateNodesFromMarkdownFiles(
    plan,
    [{ name: "Imported Markdown", markdown: markdownText }],
    context
  );

  if (topItemIDs.length > 0) {
    return [nextPlan, topItemIDs[0] as ID];
  }

  const fallbackText = "Imported Markdown";
  const fallbackNode = newNode(
    fallbackText,
    List<ID>(),
    nextPlan.user.publicKey
  );
  return [planUpsertNodes(nextPlan, fallbackNode), fallbackNode.text as ID];
}

function removeTransientRootAffects<T extends GraphPlan>(
  plan: T,
  nodeIds: LongID[]
): T {
  const transientRootIds = nodeIds.filter((nodeId) => {
    const node = plan.knowledgeDBs
      .get(plan.user.publicKey)
      ?.nodes.get(shortID(nodeId));
    return !!node && node.parent !== undefined;
  });
  if (transientRootIds.length === 0) {
    return plan;
  }
  return {
    ...plan,
    affectedRoots: transientRootIds.reduce(
      (affectedRoots, nodeId) =>
        affectedRoots.remove(nodeId).remove(shortID(nodeId)),
      plan.affectedRoots
    ),
  };
}

function moveCreatedTreesToParentContext<T extends GraphPlan>(
  plan: T,
  originalTopNodeIDs: ID[],
  sourceNodeIDs: LongID[],
  actualNodeIDs: ID[],
  targetSemanticContext: Context,
  parentNode: GraphNode
): T {
  return originalTopNodeIDs.reduce((accPlan, originalID, index) => {
    const actualID = actualNodeIDs[index];
    const sourceNodeID = sourceNodeIDs[index];
    const sourceNode = sourceNodeID
      ? getNode(accPlan.knowledgeDBs, sourceNodeID, accPlan.user.publicKey)
      : undefined;
    if (!sourceNode) {
      return accPlan;
    }
    return planMoveDescendantNodes(
      accPlan,
      sourceNode,
      targetSemanticContext,
      parentNode.id,
      actualID !== originalID ? actualID : undefined,
      parentNode.root
    );
  }, plan);
}

function planInsertMarkdownTreesByParentId<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  parentNodeId: LongID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: T;
  topItemIDs: ID[];
  topNodeIDs: LongID[];
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

  const parentNode = getNode(
    plan.knowledgeDBs,
    parentNodeId,
    plan.user.publicKey
  );
  if (!parentNode) {
    return {
      plan,
      topItemIDs: [],
      topNodeIDs: [],
      actualItemIDs: [],
    };
  }

  const [planWithNodes, topItemIDs, topNodeIDs] =
    planCreateNodesFromMarkdownTrees(plan, trees);
  const [planWithAdded, actualItemIDs] = planAddTargetsToNode(
    planWithNodes,
    parentNode,
    topNodeIDs as AddToParentTarget[],
    insertAtIndex,
    relevance,
    argument
  );
  const targetSemanticContext = getNodeContext(
    planWithAdded.knowledgeDBs,
    parentNode
  ).push(getSemanticID(planWithAdded.knowledgeDBs, parentNode));
  const movedPlan = moveCreatedTreesToParentContext(
    planWithAdded,
    topItemIDs,
    topNodeIDs,
    actualItemIDs,
    targetSemanticContext,
    parentNode
  );

  return {
    plan: removeTransientRootAffects(movedPlan, topNodeIDs),
    topItemIDs,
    topNodeIDs,
    actualItemIDs,
  };
}

export function planInsertMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: Plan;
  topItemIDs: ID[];
  topNodeIDs: LongID[];
  actualItemIDs: Array<ID>;
} {
  const parentNode = getNodeForView(plan, parentRowPath, stack);
  return parentNode
    ? planInsertMarkdownTreesByParentId(
        plan,
        trees,
        parentNode.id,
        insertAtIndex,
        relevance,
        argument
      )
    : {
        plan,
        topItemIDs: [],
        topNodeIDs: [],
        actualItemIDs: [],
      };
}
