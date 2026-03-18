import { Map } from "immutable";
import {
  getNodeContext,
  getSemanticID,
  isSearchId,
  shortID,
} from "../graph/context";
import { getNode } from "../graph/queries";
import { resolveNode, isRefNode } from "../graph/references";
import {
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planRemoveChildNodeById,
  planAddTargetsToNode,
  planCopyDescendantNodes,
  type AddToParentTarget,
} from "../graph/commands";
import type {
  Context,
  GraphNode,
  ID,
  LongID,
  Relevance,
  Argument,
} from "../graph/types";
import {
  getNodeIndexForView,
  getRowIDFromView,
  getContext,
  getNodeForView,
  addNodeToPathWithNodes,
} from "../rows/resolveRow";
import {
  getLast,
  getPaneIndex,
  getParentRowPath,
  isRoot,
  type RowPath,
  rowPathToString,
} from "../rows/rowPaths";
import {
  bulkUpdateRowPathsAfterAddNode,
  copyViewsWithNodesMapping,
  copyViewsWithNewPrefix,
  planUpdateViews,
} from "../session/views";
import {
  planExpandNode,
  updateRowPathsAfterDisconnect,
} from "./navigationActions";
import { getPane, planUpdatePanes } from "../session/panes";
import type { Pane, Views } from "../session/types";
import { upsertNodes } from "./actions";
import type { Plan } from "./types";

function updateViewsWithNodesMapping(
  views: Views,
  nodesIdMapping: Map<LongID, LongID>
): Views {
  return views.mapEntries(([key, view]) => {
    const newKey = nodesIdMapping.reduce(
      (currentKey, newId, oldId) => currentKey.split(oldId).join(newId),
      key
    );
    return [newKey, view];
  });
}

export function planAddToParent(
  plan: Plan,
  targets: AddToParentTarget | AddToParentTarget[],
  parentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, ID[]] {
  const ensureParentNode = (): [Plan, GraphNode] => {
    const [, parentView] = getRowIDFromView(plan, parentRowPath);
    const planWithExpand = planExpandNode(plan, parentView, parentRowPath);
    const existingNode = getNodeForView(planWithExpand, parentRowPath, stack);
    if (existingNode) {
      return [planWithExpand, existingNode];
    }
    const planWithParentNode = upsertNodes(
      planWithExpand,
      parentRowPath,
      stack,
      (node) => node
    );
    const parentNode = getNodeForView(planWithParentNode, parentRowPath, stack);
    if (!parentNode) {
      throw new Error("Failed to create parent node");
    }
    return [planWithParentNode, parentNode];
  };

  const [planWithParent, parentNode] = ensureParentNode();
  const [updatedNodesPlan, actualNodeIDs] = planAddTargetsToNode(
    planWithParent,
    parentNode,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews = bulkUpdateRowPathsAfterAddNode(updatedNodesPlan);
  return [planUpdateViews(updatedNodesPlan, updatedViews), actualNodeIDs];
}

export function planForkPane(plan: Plan, rowPath: RowPath, stack: ID[]): Plan {
  const pane = getPane(plan, getPaneIndex(rowPath));
  const rootNode = pane.rootNodeId
    ? getNode(
        plan.knowledgeDBs,
        pane.rootNodeId,
        pane.author || plan.user.publicKey
      )
    : undefined;
  const sourceNode = rootNode || getNodeForView(plan, rowPath, stack);
  if (!sourceNode) {
    return plan;
  }
  const [planWithNodes, nodesIdMapping] = planCopyDescendantNodes(
    plan,
    sourceNode,
    (node) => getNodeContext(plan.knowledgeDBs, node),
    (node) => node.author === pane.author
  );
  const updatedViews = updateViewsWithNodesMapping(
    planWithNodes.views,
    nodesIdMapping
  );
  const planWithUpdatedViews = planUpdateViews(planWithNodes, updatedViews);
  const paneIndex = rowPath[0];
  const newRootNodeId = pane.rootNodeId
    ? nodesIdMapping.get(pane.rootNodeId)
    : undefined;
  const newPanes = planWithUpdatedViews.panes.map((currentPane, index) =>
    index === paneIndex
      ? {
          ...currentPane,
          author: plan.user.publicKey,
          rootNodeId: newRootNodeId,
        }
      : currentPane
  );
  return planUpdatePanes(planWithUpdatedViews, newPanes);
}

export function planDeepCopyNode(
  plan: Plan,
  sourceRowPath: RowPath,
  targetParentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, Map<LongID, LongID>] {
  const [sourceRowID] = getRowIDFromView(plan, sourceRowPath);
  const sourceStack = getPane(plan, getPaneIndex(sourceRowPath)).stack;
  const sourceSemanticContext = getContext(plan, sourceRowPath, sourceStack);
  const sourceNode = getNodeForView(plan, sourceRowPath, sourceStack);

  const resolveSource = (): {
    nodeID: ID;
    semanticContext: Context;
    node?: GraphNode;
  } => {
    const sourceRowNode = getNode(
      plan.knowledgeDBs,
      sourceRowID,
      plan.user.publicKey
    );
    if (isRefNode(sourceRowNode)) {
      const node = resolveNode(plan.knowledgeDBs, sourceRowNode);
      if (node) {
        return {
          nodeID: getSemanticID(plan.knowledgeDBs, node),
          semanticContext: getNodeContext(plan.knowledgeDBs, node),
          node,
        };
      }
    }
    return {
      nodeID: sourceRowID,
      semanticContext: sourceSemanticContext,
      node: sourceNode,
    };
  };

  const resolved = resolveSource();
  const resolvedNodeID = resolved.nodeID;
  const resolvedSemanticContext = resolved.semanticContext;
  const resolvedNode = resolved.node;

  const [planWithParent, targetParentNode] = (() => {
    const parentNode = getNodeForView(plan, targetParentRowPath, stack);
    if (parentNode) {
      return [plan, parentNode] as const;
    }
    const planWithCreatedParent = upsertNodes(
      plan,
      targetParentRowPath,
      stack,
      (node) => node
    );
    const createdParent = getNodeForView(
      planWithCreatedParent,
      targetParentRowPath,
      stack
    );
    if (!createdParent) {
      throw new Error("Failed to create target parent node");
    }
    return [planWithCreatedParent, createdParent] as const;
  })();

  const targetParentSemanticContext = getContext(
    planWithParent,
    targetParentRowPath,
    stack
  );
  const [targetParentRowID] = getRowIDFromView(
    planWithParent,
    targetParentRowPath
  );
  const targetRootContext = targetParentSemanticContext.push(
    targetParentNode
      ? getSemanticID(planWithParent.knowledgeDBs, targetParentNode)
      : (shortID(targetParentRowID as ID) as ID)
  );
  const sourceRootChildContext = resolvedSemanticContext.push(
    shortID(resolvedNodeID)
  );
  const targetRootChildContext = targetRootContext.push(
    shortID(resolvedNodeID)
  );

  if (!resolvedNode) {
    throw new Error("Cannot deep copy a row without a concrete source node");
  }

  const [planWithCopiedNodes, mapping] = planCopyDescendantNodes(
    planWithParent,
    resolvedNode,
    (node) => {
      const isRootNode = node.id === resolvedNode.id;
      const sourceNodeContext = getNodeContext(
        planWithParent.knowledgeDBs,
        node
      );
      return isRootNode
        ? targetRootContext
        : targetRootChildContext.concat(
            sourceNodeContext.skip(sourceRootChildContext.size)
          );
    },
    undefined,
    targetParentNode.id,
    undefined,
    targetParentNode.root
  );

  const copiedTopNodeID = mapping.get(resolvedNode.id);
  if (!copiedTopNodeID) {
    return [planWithCopiedNodes, mapping];
  }

  const [finalPlan] = planAddToParent(
    planWithCopiedNodes,
    copiedTopNodeID,
    targetParentRowPath,
    stack,
    insertAtIndex,
    relevance,
    argument
  );

  return [finalPlan, mapping];
}

export function planDeepCopyNodeWithView(
  plan: Plan,
  sourceRowPath: RowPath,
  targetParentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const [planWithCopy, nodesIdMapping] = planDeepCopyNode(
    plan,
    sourceRowPath,
    targetParentRowPath,
    stack,
    insertAtIndex
  );
  const nodes = getNodeForView(planWithCopy, targetParentRowPath, stack);
  if (!nodes || nodes.children.size === 0) {
    return planWithCopy;
  }

  const targetIndex = insertAtIndex ?? nodes.children.size - 1;
  const targetRowPath = addNodeToPathWithNodes(
    targetParentRowPath,
    nodes,
    targetIndex
  );
  const sourceKey = rowPathToString(sourceRowPath);
  const targetKey = rowPathToString(targetRowPath);
  const updatedViews = copyViewsWithNodesMapping(
    planWithCopy.views,
    sourceKey,
    targetKey,
    nodesIdMapping
  );
  return planUpdateViews(planWithCopy, updatedViews);
}

function resetInvalidPanes(plan: Plan, paneIndexToReset?: number): Plan {
  const shouldResetPane = (pane: Pane, index: number): boolean => {
    if (paneIndexToReset !== undefined && index === paneIndexToReset) {
      return true;
    }
    if (pane.rootNodeId !== undefined) {
      return (
        getNodeForView(
          plan,
          [index, pane.rootNodeId] as RowPath,
          pane.stack
        ) === undefined
      );
    }
    if (pane.stack.length === 0) {
      return false;
    }
    const rootRowPath: RowPath = [
      index,
      pane.rootNodeId || pane.stack[pane.stack.length - 1],
    ];
    return getNodeForView(plan, rootRowPath, pane.stack) === undefined;
  };

  const nextPanes = plan.panes.map((pane, index) =>
    shouldResetPane(pane, index)
      ? { ...pane, stack: [], rootNodeId: undefined }
      : pane
  );
  return planUpdatePanes(plan, nextPanes);
}

export function planDisconnectFromParent(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  preserveDescendants?: boolean
): Plan {
  const parentRowPath = getParentRowPath(rowPath);
  if (!parentRowPath) {
    return plan;
  }

  const nodeIndex = getNodeIndexForView(plan, rowPath);
  if (nodeIndex === undefined) {
    return plan;
  }

  const disconnectID = getLast(rowPath);
  const parentNode = getNodeForView(plan, parentRowPath, stack);
  if (!parentNode || parentNode.author !== plan.user.publicKey) {
    return plan;
  }

  const updatedNodesPlan = planRemoveChildNodeById(
    plan,
    parentNode.id,
    getLast(rowPath),
    preserveDescendants === undefined ? false : !!preserveDescendants
  );

  const updatedViews = updateRowPathsAfterDisconnect(
    updatedNodesPlan.views,
    disconnectID,
    parentNode.id
  );

  return resetInvalidPanes(planUpdateViews(updatedNodesPlan, updatedViews));
}

export function planDeleteNodeFromView(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[]
): Plan {
  if (!isRoot(rowPath)) {
    return planDisconnectFromParent(plan, rowPath, stack);
  }

  const [rowID] = getRowIDFromView(plan, rowPath);
  if (isSearchId(rowID as ID)) {
    return plan;
  }

  const node = getNodeForView(plan, rowPath, stack);
  if (!node || node.author !== plan.user.publicKey) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantNodes(plan, node);
  const planAfterDelete = planDeleteNodes(planAfterDescendants, node.id);
  return resetInvalidPanes(planAfterDelete, getPaneIndex(rowPath));
}

export function planMoveNodeWithView(
  plan: Plan,
  sourceRowPath: RowPath,
  targetParentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const [sourceRowID] = getRowIDFromView(plan, sourceRowPath);
  const sourceStack = getPane(plan, getPaneIndex(sourceRowPath)).stack;
  const sourceNode = getNodeForView(plan, sourceRowPath, sourceStack);
  const sourceAddID = sourceNode?.id ?? sourceRowID;

  const [planWithAdd, [actualRowID]] = planAddToParent(
    plan,
    sourceAddID,
    targetParentRowPath,
    stack,
    insertAtIndex
  );

  const moveRowID = actualRowID ?? sourceRowID;

  const targetParentContext = getContext(
    planWithAdd,
    targetParentRowPath,
    stack
  );
  const [targetParentRowID] = getRowIDFromView(
    planWithAdd,
    targetParentRowPath
  );
  const actualTargetParentNode = getNodeForView(
    planWithAdd,
    targetParentRowPath,
    stack
  );
  const targetContext = targetParentContext.push(
    shortID(
      (actualTargetParentNode
        ? getSemanticID(planWithAdd.knowledgeDBs, actualTargetParentNode)
        : targetParentRowID) as ID
    )
  );

  const targetParentNode = getNodeForView(
    planWithAdd,
    targetParentRowPath,
    stack
  );
  if (!targetParentNode || targetParentNode.children.size === 0) {
    return planDisconnectFromParent(planWithAdd, sourceRowPath, stack, true);
  }

  const targetIndex = insertAtIndex ?? targetParentNode.children.size - 1;
  const targetRowPath = addNodeToPathWithNodes(
    targetParentRowPath,
    targetParentNode,
    targetIndex
  );

  const sourceKey = rowPathToString(sourceRowPath);
  const targetKey = rowPathToString(targetRowPath);
  const preservedSourceViews =
    sourceKey === targetKey
      ? planWithAdd.views.filter(
          (_view, key) => key === sourceKey || key.startsWith(`${sourceKey}:`)
        )
      : undefined;
  const updatedViews = copyViewsWithNewPrefix(
    planWithAdd.views,
    sourceKey,
    targetKey
  );
  const planWithViews = planUpdateViews(planWithAdd, updatedViews);

  const disconnectedPlan = planDisconnectFromParent(
    planWithViews,
    sourceRowPath,
    stack,
    true
  );
  const planWithDisconnect =
    preservedSourceViews && preservedSourceViews.size > 0
      ? planUpdateViews(
          disconnectedPlan,
          disconnectedPlan.views.merge(preservedSourceViews)
        )
      : disconnectedPlan;

  if (!sourceNode) {
    return planWithDisconnect;
  }

  return planMoveDescendantNodes(
    planWithDisconnect,
    sourceNode,
    targetContext,
    actualTargetParentNode?.id,
    moveRowID !== sourceRowID ? moveRowID : undefined,
    actualTargetParentNode?.root
  );
}
