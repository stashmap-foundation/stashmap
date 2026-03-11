import {
  isEmptySemanticID,
  updateItemArgument,
  updateItemRelevance,
} from "./connections";
import {
  getParentView,
  getRelationForView,
  getRelationIndex,
  getRowIDFromView,
  upsertRelations,
  viewPathToString,
  ViewPath,
  VirtualItemsMap,
} from "./ViewContext";
import {
  Plan,
  planAddToParent,
  planDeepCopyNode,
  planSaveNodeAndEnsureRelations,
  planUpdateEmptyNodeMetadata,
} from "./planner";

export type RelationItemMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

export function updateRelationItemMetadata(
  relations: Relations,
  relationIndex: number,
  metadata: RelationItemMetadata
): Relations {
  const withRelevance =
    "relevance" in metadata
      ? updateItemRelevance(relations, relationIndex, metadata.relevance)
      : relations;
  return "argument" in metadata
    ? updateItemArgument(withRelevance, relationIndex, metadata.argument)
    : withRelevance;
}

function getNodeText(plan: Plan, viewPath: ViewPath, stack: ID[]): string {
  return getRelationForView(plan, viewPath, stack)?.text ?? "";
}

export function planUpdateExistingItemMetadata(
  plan: Plan,
  parentViewPath: ViewPath,
  stack: ID[],
  relationIndex: number,
  metadata: RelationItemMetadata
): Plan {
  return upsertRelations(plan, parentViewPath, stack, (relations) =>
    updateRelationItemMetadata(relations, relationIndex, metadata)
  );
}

export function planUpdateViewItemMetadata(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  metadata: RelationItemMetadata,
  editorText: string,
  virtualItemsMap?: VirtualItemsMap
): Plan {
  const [itemID] = getRowIDFromView(plan, viewPath);
  const parentView = getParentView(viewPath);
  if (!parentView) {
    return plan;
  }

  if (isEmptySemanticID(itemID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      return planSaveNodeAndEnsureRelations(
        plan,
        trimmed,
        viewPath,
        stack,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    const relations = getRelationForView(plan, parentView, stack);
    return relations
      ? planUpdateEmptyNodeMetadata(plan, relations.id, metadata)
      : plan;
  }

  const relationIndex = getRelationIndex(plan, viewPath);
  if (relationIndex === undefined) {
    const virtualItem = virtualItemsMap?.get(viewPathToString(viewPath));
    if (!virtualItem) {
      return plan;
    }
    if (virtualItem.virtualType === "suggestion" && !virtualItem.isCref) {
      return planDeepCopyNode(
        plan,
        viewPath,
        parentView,
        stack,
        undefined,
        metadata.relevance,
        metadata.argument
      )[0];
    }
    return planAddToParent(
      plan,
      itemID,
      parentView,
      stack,
      undefined,
      metadata.relevance,
      metadata.argument
    )[0];
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== getNodeText(plan, viewPath, stack)
      ? planSaveNodeAndEnsureRelations(plan, editorText, viewPath, stack).plan
      : plan;

  return planUpdateExistingItemMetadata(
    basePlan,
    parentView,
    stack,
    relationIndex,
    metadata
  );
}
