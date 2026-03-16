import {
  createRefTarget,
  isEmptySemanticID,
  getNode,
  isRefNode,
} from "./connections";
import { planUpdateNodeItemMetadataById } from "./dataPlanner";
import { NodeItemMetadata } from "./nodeItemMetadata";
import {
  getParentView,
  getNodeForView,
  getNodeIndexForView,
  getRowIDFromView,
  viewPathToString,
  ViewPath,
  VirtualRowsMap,
} from "./ViewContext";
import {
  Plan,
  planAddToParent,
  planDeepCopyNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
} from "./planner";

export type { NodeItemMetadata } from "./nodeItemMetadata";

function getNodeText(plan: Plan, viewPath: ViewPath, stack: ID[]): string {
  return getNodeForView(plan, viewPath, stack)?.text ?? "";
}

function planUpdateExistingItemMetadata(
  plan: Plan,
  parentViewPath: ViewPath,
  stack: ID[],
  nodeIndex: number,
  metadata: NodeItemMetadata
): Plan {
  const nodes = getNodeForView(plan, parentViewPath, stack);
  const itemId = nodes?.children.get(nodeIndex);
  return nodes && itemId
    ? planUpdateNodeItemMetadataById(plan, nodes.id, itemId, metadata)
    : plan;
}

export function planUpdateViewItemMetadata(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  metadata: NodeItemMetadata,
  editorText: string,
  virtualRowsMap?: VirtualRowsMap
): Plan {
  const [rowID] = getRowIDFromView(plan, viewPath);
  const parentView = getParentView(viewPath);
  if (!parentView) {
    return plan;
  }

  if (isEmptySemanticID(rowID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      return planSaveNodeAndEnsureNodes(
        plan,
        trimmed,
        viewPath,
        stack,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    const nodes = getNodeForView(plan, parentView, stack);
    return nodes ? planUpdateEmptyNodeMetadata(plan, nodes.id, metadata) : plan;
  }

  const nodeIndex = getNodeIndexForView(plan, viewPath);
  if (nodeIndex === undefined) {
    const virtualRow = virtualRowsMap?.get(viewPathToString(viewPath));
    if (!virtualRow) {
      return plan;
    }
    if (virtualRow.virtualType === "suggestion" && !isRefNode(virtualRow)) {
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
    const targetID = virtualRow.targetID || undefined;
    const targetItem = targetID ? createRefTarget(targetID) : rowID;
    const inheritedSourceNode = targetID
      ? getNode(plan.knowledgeDBs, targetID, plan.user.publicKey)
      : undefined;
    return planAddToParent(
      plan,
      targetItem,
      parentView,
      stack,
      undefined,
      metadata.relevance ?? inheritedSourceNode?.relevance,
      metadata.argument ?? inheritedSourceNode?.argument
    )[0];
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== getNodeText(plan, viewPath, stack)
      ? planSaveNodeAndEnsureNodes(plan, editorText, viewPath, stack).plan
      : plan;

  return planUpdateExistingItemMetadata(
    basePlan,
    parentView,
    stack,
    nodeIndex,
    metadata
  );
}
