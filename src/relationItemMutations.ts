import { isEmptySemanticID } from "./connections";
import { planUpdateRelationItemMetadataById } from "./dataPlanner";
import { RelationItemMetadata } from "./relationItemMetadata";
import {
  getParentView,
  getRelationForView,
  getRelationIndex,
  getRowIDFromView,
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

export type { RelationItemMetadata } from "./relationItemMetadata";

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
  const relations = getRelationForView(plan, parentViewPath, stack);
  const itemId = relations?.items.get(relationIndex)?.id;
  return relations && itemId
    ? planUpdateRelationItemMetadataById(plan, relations.id, itemId, metadata)
    : plan;
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
