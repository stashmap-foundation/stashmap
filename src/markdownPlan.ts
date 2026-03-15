import { List } from "immutable";
import { getNodeContext, getSemanticID, getNode, shortID } from "./connections";
import { MarkdownImportFile, parseMarkdownImportFiles } from "./markdownImport";
import { createNodesFromMarkdownTrees, WalkContext } from "./markdownRelations";
import { MarkdownTreeNode } from "./markdownTree";
import {
  AddToParentTarget,
  GraphPlan,
  Plan,
  planAddTargetsToRelation,
  planMoveDescendantRelations,
  planUpsertRelations,
} from "./planner";
import { newRelations } from "./relationFactory";
import { getNodeForView, ViewPath } from "./ViewContext";

export function planCreateNodesFromMarkdownTrees<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [T, topItemIDs: ID[], topRelationIDs: LongID[]] {
  const walkContext: WalkContext = {
    knowledgeDBs: plan.knowledgeDBs,
    publicKey: plan.user.publicKey,
    affectedRoots: plan.affectedRoots,
  };
  const [resultContext, topItemIDs, topRelationIDs] =
    createNodesFromMarkdownTrees(walkContext, trees, context);
  return [
    {
      ...plan,
      knowledgeDBs: resultContext.knowledgeDBs,
      affectedRoots: resultContext.affectedRoots,
    },
    topItemIDs,
    topRelationIDs,
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
  const fallbackRelation = newRelations(
    fallbackText,
    List<ID>(),
    nextPlan.user.publicKey
  );
  return [
    planUpsertRelations(nextPlan, fallbackRelation),
    fallbackRelation.text as ID,
  ];
}

function removeTransientRootAffects<T extends GraphPlan>(
  plan: T,
  relationIds: LongID[]
): T {
  const transientRootIds = relationIds.filter((relationId) => {
    const relation = plan.knowledgeDBs
      .get(plan.user.publicKey)
      ?.nodes.get(shortID(relationId));
    return !!relation && relation.parent !== undefined;
  });
  if (transientRootIds.length === 0) {
    return plan;
  }
  return {
    ...plan,
    affectedRoots: transientRootIds.reduce(
      (affectedRoots, relationId) =>
        affectedRoots.remove(relationId).remove(shortID(relationId)),
      plan.affectedRoots
    ),
  };
}

function moveCreatedTreesToParentContext<T extends GraphPlan>(
  plan: T,
  originalTopNodeIDs: ID[],
  sourceRelationIDs: LongID[],
  actualNodeIDs: ID[],
  targetSemanticContext: Context,
  parentRelation: GraphNode
): T {
  return originalTopNodeIDs.reduce((accPlan, originalID, index) => {
    const actualID = actualNodeIDs[index];
    const sourceRelationID = sourceRelationIDs[index];
    const sourceRelation = sourceRelationID
      ? getNode(accPlan.knowledgeDBs, sourceRelationID, accPlan.user.publicKey)
      : undefined;
    if (!sourceRelation) {
      return accPlan;
    }
    return planMoveDescendantRelations(
      accPlan,
      sourceRelation,
      targetSemanticContext,
      parentRelation.id,
      actualID !== originalID ? actualID : undefined,
      parentRelation.root
    );
  }, plan);
}

export function planInsertMarkdownTreesByParentId<T extends GraphPlan>(
  plan: T,
  trees: MarkdownTreeNode[],
  parentRelationId: LongID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: T;
  topItemIDs: ID[];
  topRelationIDs: LongID[];
  actualItemIDs: Array<ID>;
} {
  if (trees.length === 0) {
    return {
      plan,
      topItemIDs: [],
      topRelationIDs: [],
      actualItemIDs: [],
    };
  }

  const parentRelation = getNode(
    plan.knowledgeDBs,
    parentRelationId,
    plan.user.publicKey
  );
  if (!parentRelation) {
    return {
      plan,
      topItemIDs: [],
      topRelationIDs: [],
      actualItemIDs: [],
    };
  }

  const [planWithNodes, topItemIDs, topRelationIDs] =
    planCreateNodesFromMarkdownTrees(plan, trees);
  const [planWithAdded, actualItemIDs] = planAddTargetsToRelation(
    planWithNodes,
    parentRelation,
    topRelationIDs as AddToParentTarget[],
    insertAtIndex,
    relevance,
    argument
  );
  const targetSemanticContext = getNodeContext(
    planWithAdded.knowledgeDBs,
    parentRelation
  ).push(getSemanticID(planWithAdded.knowledgeDBs, parentRelation));
  const movedPlan = moveCreatedTreesToParentContext(
    planWithAdded,
    topItemIDs,
    topRelationIDs,
    actualItemIDs,
    targetSemanticContext,
    parentRelation
  );

  return {
    plan: removeTransientRootAffects(movedPlan, topRelationIDs),
    topItemIDs,
    topRelationIDs,
    actualItemIDs,
  };
}

export function planInsertMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): {
  plan: Plan;
  topItemIDs: ID[];
  topRelationIDs: LongID[];
  actualItemIDs: Array<ID>;
} {
  const parentRelation = getNodeForView(plan, parentViewPath, stack);
  return parentRelation
    ? planInsertMarkdownTreesByParentId(
        plan,
        trees,
        parentRelation.id,
        insertAtIndex,
        relevance,
        argument
      )
    : {
        plan,
        topItemIDs: [],
        topRelationIDs: [],
        actualItemIDs: [],
      };
}
