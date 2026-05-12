import { List } from "immutable";
import { v4 } from "uuid";
import {
  getNodeContext,
  getSemanticID,
  getNode,
  shortID,
} from "./core/connections";
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
import { nodeText, plainSpans } from "./core/nodeSpans";
import { getNodeForView, ViewPath } from "./ViewContext";

export function planCreateNodesFromMarkdownTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>(),
  options: { createDocuments?: boolean } = {}
): [T, topItemIDs: ID[], topNodeIDs: LongID[]] {
  const createDocuments = options.createDocuments ?? true;
  const walkContext: WalkContext = {
    knowledgeDBs: plan.knowledgeDBs,
    publicKey: plan.user.publicKey,
    affectedDocuments: plan.affectedDocuments,
  };
  const treesWithDocIds = createDocuments
    ? trees.map((tree) => ({
        ...tree,
        docId: tree.docId ?? v4(),
      }))
    : trees;
  const result = materializeTree(treesWithDocIds, plan.user.publicKey, {
    context: walkContext,
    semanticContext: context,
  });
  const planWithNodes: T = {
    ...plan,
    knowledgeDBs: result.context.knowledgeDBs,
    affectedDocuments: result.context.affectedDocuments,
  };
  if (!createDocuments) {
    return [planWithNodes, result.topSemanticIds, result.topNodeIds];
  }
  const userNodes = result.context.knowledgeDBs.get(plan.user.publicKey)?.nodes;
  const planWithDocs = result.topNodeIds.reduce<T>((acc, longId) => {
    const rootNode = userNodes?.get(shortID(longId));
    return rootNode ? planUpsertRootDocument(acc, rootNode) : acc;
  }, planWithNodes);
  return [planWithDocs, result.topSemanticIds, result.topNodeIds];
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
  const fallbackNode = withDocumentRoot(
    newGraphNode(nextPlan.user.publicKey, plainSpans(fallbackText), {
      semanticContext: List<ID>(),
    })
  );
  return [
    planUpsertNodes(nextPlan, fallbackNode),
    nodeText(fallbackNode) as ID,
  ];
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
    planCreateNodesFromMarkdownTrees(plan, trees, List<ID>(), {
      createDocuments: false,
    });
  const targetSemanticContext = getNodeContext(
    planWithNodes.knowledgeDBs,
    parentNode
  ).push(getSemanticID(planWithNodes.knowledgeDBs, parentNode));
  const movedPlan = moveCreatedTreesToParentContext(
    planWithNodes,
    topItemIDs,
    topNodeIDs,
    topNodeIDs,
    targetSemanticContext,
    parentNode
  );
  const [planWithAdded, actualItemIDs] = planAddTargetsToNode(
    movedPlan,
    parentNode,
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
  parentViewPath: ViewPath,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: Plan;
  topItemIDs: ID[];
  topNodeIDs: LongID[];
  actualItemIDs: Array<ID>;
} {
  const parentNode = getNodeForView(plan, parentViewPath);
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
