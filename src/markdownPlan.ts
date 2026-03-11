import { List } from "immutable";
import { createSemanticID, hashText, shortID } from "./connections";
import { MarkdownImportFile, parseMarkdownImportFiles } from "./markdownImport";
import { createNodesFromMarkdownTrees, WalkContext } from "./markdownRelations";
import { MarkdownTreeNode } from "./markdownTree";
import {
  Plan,
  planAddToParent,
  planMoveTreeDescendantsToContext,
  planUpsertRelations,
} from "./planner";
import { newRelations } from "./relationFactory";
import { getRelationForView, ViewPath } from "./ViewContext";

export function planCreateNodesFromMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [Plan, topItemIDs: ID[], topRelationIDs: LongID[]] {
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

export function planCreateNodesFromMarkdownFiles(
  plan: Plan,
  files: MarkdownImportFile[],
  context: List<ID> = List<ID>()
): [Plan, topItemIDs: ID[]] {
  const trees = parseMarkdownImportFiles(files);
  const [nextPlan, topItemIDs] = planCreateNodesFromMarkdownTrees(
    plan,
    trees,
    context
  );
  return [nextPlan, topItemIDs];
}

export function planCreateNodesFromMarkdown(
  plan: Plan,
  markdownText: string,
  context: List<ID> = List<ID>()
): [Plan, topItemID: ID] {
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
    createSemanticID(fallbackText),
    List<ID>(),
    nextPlan.user.publicKey,
    undefined,
    undefined,
    fallbackText
  );
  const fallbackRelationWithText: Relations = {
    ...fallbackRelation,
    text: fallbackText,
    textHash: hashText(fallbackText),
  };
  return [
    planUpsertRelations(nextPlan, fallbackRelationWithText),
    fallbackRelation.textHash,
  ];
}

function removeTransientRootAffects(plan: Plan, relationIds: LongID[]): Plan {
  const transientRootIds = relationIds.filter((relationId) => {
    const relation = plan.knowledgeDBs
      .get(plan.user.publicKey)
      ?.relations.get(shortID(relationId));
    return !!relation && relation.parent !== undefined;
  });
  if (transientRootIds.length === 0) {
    return plan;
  }
  return {
    ...plan,
    affectedRoots: transientRootIds.reduce(
      (affectedRoots, relationId) => affectedRoots.remove(shortID(relationId)),
      plan.affectedRoots
    ),
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
  actualItemIDs: Array<LongID | ID>;
} {
  if (trees.length === 0) {
    return {
      plan,
      topItemIDs: [],
      topRelationIDs: [],
      actualItemIDs: [],
    };
  }

  const parentRelation = getRelationForView(plan, parentViewPath, stack);
  const parentRoot = parentRelation?.root;
  const [planWithNodes, topItemIDs, topRelationIDs] =
    planCreateNodesFromMarkdownTrees(plan, trees);
  const [planWithAdded, actualItemIDs] = planAddToParent(
    planWithNodes,
    topRelationIDs,
    parentViewPath,
    stack,
    insertAtIndex,
    relevance,
    argument
  );
  const movedPlan = planMoveTreeDescendantsToContext(
    planWithAdded,
    topItemIDs,
    topRelationIDs,
    actualItemIDs,
    parentViewPath,
    stack,
    parentRoot
  );

  return {
    plan: removeTransientRootAffects(movedPlan, topRelationIDs),
    topItemIDs,
    topRelationIDs,
    actualItemIDs,
  };
}
