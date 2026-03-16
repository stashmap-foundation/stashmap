import {
  createRefTarget,
  isEmptySemanticID,
  getNode,
  isRefNode,
} from "./connections";
import { planUpdateNodeItemMetadataById } from "./dataPlanner";
import { NodeItemMetadata } from "./nodeItemMetadata";
import {
  getNodeForView,
  getNodeIndexForView,
  getRowIDFromView,
} from "./rows/resolveRow";
import {
  getParentRowPath,
  rowPathToString,
  type RowPath,
} from "./rows/rowPaths";
import type { VirtualRowsMap } from "./rows/types";
import {
  Plan,
  planAddToParent,
  planDeepCopyNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
} from "./planner";

export type { NodeItemMetadata } from "./nodeItemMetadata";

function getNodeText(plan: Plan, rowPath: RowPath, stack: ID[]): string {
  return getNodeForView(plan, rowPath, stack)?.text ?? "";
}

function planUpdateExistingItemMetadata(
  plan: Plan,
  parentRowPath: RowPath,
  stack: ID[],
  nodeIndex: number,
  metadata: NodeItemMetadata
): Plan {
  const nodes = getNodeForView(plan, parentRowPath, stack);
  const itemId = nodes?.children.get(nodeIndex);
  return nodes && itemId
    ? planUpdateNodeItemMetadataById(plan, nodes.id, itemId, metadata)
    : plan;
}

export function planUpdateViewItemMetadata(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  metadata: NodeItemMetadata,
  editorText: string,
  virtualRowsMap?: VirtualRowsMap
): Plan {
  const [rowID] = getRowIDFromView(plan, rowPath);
  const parentView = getParentRowPath(rowPath);
  if (!parentView) {
    return plan;
  }

  if (isEmptySemanticID(rowID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      return planSaveNodeAndEnsureNodes(
        plan,
        trimmed,
        rowPath,
        stack,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    const nodes = getNodeForView(plan, parentView, stack);
    return nodes ? planUpdateEmptyNodeMetadata(plan, nodes.id, metadata) : plan;
  }

  const nodeIndex = getNodeIndexForView(plan, rowPath);
  if (nodeIndex === undefined) {
    const virtualRow = virtualRowsMap?.get(rowPathToString(rowPath));
    if (!virtualRow) {
      return plan;
    }
    if (virtualRow.virtualType === "suggestion" && !isRefNode(virtualRow)) {
      return planDeepCopyNode(
        plan,
        rowPath,
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
    trimmed && trimmed !== getNodeText(plan, rowPath, stack)
      ? planSaveNodeAndEnsureNodes(plan, editorText, rowPath, stack).plan
      : plan;

  return planUpdateExistingItemMetadata(
    basePlan,
    parentView,
    stack,
    nodeIndex,
    metadata
  );
}
