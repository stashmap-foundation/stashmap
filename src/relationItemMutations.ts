import {
  createRefTarget,
  isEmptySemanticID,
  getNode,
  getRefTargetID,
  isRefNode,
} from "./connections";
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
  const nodes = getRelationForView(plan, parentViewPath, stack);
  const itemId = nodes?.children.get(relationIndex);
  return nodes && itemId
    ? planUpdateRelationItemMetadataById(plan, nodes.id, itemId, metadata)
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
    const nodes = getRelationForView(plan, parentView, stack);
    return nodes ? planUpdateEmptyNodeMetadata(plan, nodes.id, metadata) : plan;
  }

  const relationIndex = getRelationIndex(plan, viewPath);
  if (relationIndex === undefined) {
    const virtualItem = virtualItemsMap?.get(viewPathToString(viewPath));
    if (!virtualItem) {
      return plan;
    }
    if (virtualItem.virtualType === "suggestion" && !isRefNode(virtualItem)) {
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
    const targetID =
      getRefTargetID(virtualItem) ||
      (virtualItem.virtualType === "occurrence"
        ? (itemID as LongID)
        : undefined);
    const targetItem = targetID ? createRefTarget(targetID) : itemID;
    const inheritedSourceRelation = targetID
      ? getNode(plan.knowledgeDBs, targetID, plan.user.publicKey)
      : undefined;
    return planAddToParent(
      plan,
      targetItem,
      parentView,
      stack,
      undefined,
      metadata.relevance ?? inheritedSourceRelation?.relevance,
      metadata.argument ?? inheritedSourceRelation?.argument
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
