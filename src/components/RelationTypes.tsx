import React from "react";
import { Dropdown } from "react-bootstrap";
import { OrderedMap, Set } from "immutable";
import {
  Plan,
  planUpdateViews,
  planUpsertRelations,
  usePlanner,
  planOpenCreateNodeEditor,
  planCloseCreateNodeEditor,
} from "../planner";
import { getRelationsNoReferencedBy } from "../connections";
import { REFERENCED_BY } from "../constants";
import {
  ViewPath,
  contextsMatch,
  getContextFromStackAndViewPath,
  getDefaultRelationForNode,
  getAvailableRelationsForNode,
  newRelations,
  updateView,
  useNode,
  useViewPath,
  isExpanded,
  getViewFromPath,
  getNodeIDFromView,
  viewPathToString,
  parseViewPath,
} from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";

export const DEFAULT_COLOR = "#027d86";

export const COLORS = [
  "#0288d1", // Bright blue - relevant to
  "#00acc1", // Cyan - maybe relevant
  "#26c6da", // Light cyan - little relevant
  "#757575", // Dark gray - not relevant
  "#2e7d32", // Dark green - confirms
  "#c62828", // Dark red - contra
  "#9c27b0", // Bright purple - contains
];

// Semantic grouping: Relevance types, Evidence types, Structure types
export const RELATION_TYPES = OrderedMap<RelationType>({
  // Relevance group - Blue spectrum
  "": {
    color: COLORS[0], // Bright blue
    label: "relevant to",
    invertedRelationLabel: "relevant for",
  },
  maybe_relevant: {
    color: COLORS[1], // Cyan
    label: "maybe relevant to",
    invertedRelationLabel: "maybe relevant for",
  },
  little_relevant: {
    color: COLORS[2], // Light cyan
    label: "little relevant to",
    invertedRelationLabel: "little relevant for",
  },
  not_relevant: {
    color: COLORS[3], // Dark gray
    label: "not relevant to",
    invertedRelationLabel: "not relevant for",
  },
  // Evidence group
  confirms: {
    color: COLORS[4], // Dark green
    label: "confirmed by",
    invertedRelationLabel: "confirms",
  },
  contra: {
    color: COLORS[5], // Dark red
    label: "contradicted by",
    invertedRelationLabel: "contradicts",
  },
  // Structure group
  contains: {
    color: COLORS[6], // Purple
    label: "contains",
    invertedRelationLabel: "contained in",
  },
});

export const VIRTUAL_LISTS = OrderedMap<RelationType>({
  [REFERENCED_BY]: {
    color: "black",
    label: "Referenced By",
    invertedRelationLabel: "references",
  },
});

export function useGetAllRelationTypes(): RelationTypes {
  return RELATION_TYPES;
}

export function useGetAllVirtualLists(): RelationTypes {
  return VIRTUAL_LISTS;
}

export function planAddNewRelationToNode(
  plan: Plan,
  nodeID: ID,
  context: Context,
  view: View,
  viewPath: ViewPath
): Plan {
  const relations = newRelations(nodeID, context, plan.user.publicKey);
  const createRelationPlan = planUpsertRelations(plan, relations);
  return planUpdateViews(
    createRelationPlan,
    updateView(plan.views, viewPath, {
      ...view,
      relations: relations.id,
      expanded: true,
    })
  );
}

// Unified function for expanding a node with proper relation handling
// This ensures consistent logic whether triggered by triangle toggle or button
export function planExpandNode(
  plan: Plan,
  nodeID: LongID | ID,
  context: Context,
  view: View,
  viewPath: ViewPath
): Plan {
  // 1. Check if view.relations is valid (exists in DB) AND context matches
  const currentRelations = view.relations
    ? getRelationsNoReferencedBy(
        plan.knowledgeDBs,
        view.relations,
        plan.user.publicKey
      )
    : undefined;

  if (currentRelations && contextsMatch(currentRelations.context, context)) {
    // Valid relations with matching context - just expand
    return planUpdateViews(
      plan,
      updateView(plan.views, viewPath, {
        ...view,
        expanded: true,
      })
    );
  }

  // 2. Check for available relations for this (head, context)
  const availableRelations = getAvailableRelationsForNode(
    plan.knowledgeDBs,
    plan.user.publicKey,
    nodeID,
    context
  );

  if (availableRelations.size > 0) {
    // Use first available relation
    const firstRelation = availableRelations.first()!;
    return planUpdateViews(
      plan,
      updateView(plan.views, viewPath, {
        ...view,
        relations: firstRelation.id,
        expanded: true,
      })
    );
  }

  // 3. No relations exist - create new one
  const relations = newRelations(nodeID, context, plan.user.publicKey);
  const createRelationPlan = planUpsertRelations(plan, relations);
  return planUpdateViews(
    createRelationPlan,
    updateView(plan.views, viewPath, {
      ...view,
      relations: relations.id,
      expanded: true,
    })
  );
}

// Helper to determine insert position based on whether node is ROOT or expanded
export function getInsertPosition(
  plan: Plan,
  viewPath: ViewPath
): CreateNodeEditorPosition {
  const isRoot = viewPath.length === 2;
  const viewKey = viewPathToString(viewPath);
  const nodeIsExpanded = isExpanded(plan, viewKey);
  return isRoot || nodeIsExpanded ? "asFirstChild" : "afterSibling";
}

// Combined plan: expand node if needed and open create node editor
// This is the main entry point for opening the create node editor
export function planExpandAndOpenCreateNodeEditor(
  plan: Plan,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): Plan {
  const viewKey = viewPathToString(viewPath);
  const position = getInsertPosition(plan, viewPath);
  const nodeIsExpanded = isExpanded(plan, viewKey);

  // If inserting as first child but node is collapsed, expand it first
  const expandedPlan =
    position === "asFirstChild" && !nodeIsExpanded
      ? planExpandNode(
          plan,
          getNodeIDFromView(plan, viewPath)[0],
          getContextFromStackAndViewPath(stack, viewPath),
          getViewFromPath(plan, viewPath),
          viewPath
        )
      : plan;

  // Open the create node editor
  return planOpenCreateNodeEditor(expandedPlan, viewKey, position);
}

// Helper to parse viewKey and call planExpandAndOpenCreateNodeEditor
export function planExpandAndOpenCreateNodeEditorByKey(
  plan: Plan,
  viewKey: string,
  stack: (LongID | ID)[]
): Plan {
  const viewPath = parseViewPath(viewKey);
  return planExpandAndOpenCreateNodeEditor(plan, viewPath, stack);
}

export function planAddVirtualListToView(
  plan: Plan,
  virtualList: LongID,
  view: View,
  viewPath: ViewPath
): Plan {
  return planUpdateViews(
    plan,
    updateView(plan.views, viewPath, {
      ...view,
      virtualLists: Set(view.virtualLists).add(virtualList).toArray(),
      relations: REFERENCED_BY,
      expanded: true,
    })
  );
}

export function planRemoveVirtualListFromView(
  plan: Plan,
  virtualList: LongID,
  view: View,
  viewPath: ViewPath,
  nodeID: LongID
): Plan {
  return planUpdateViews(
    plan,
    updateView(plan.views, viewPath, {
      ...view,
      virtualLists: Set(view.virtualLists).remove(virtualList).toArray(),
      relations: getDefaultRelationForNode(
        nodeID,
        plan.knowledgeDBs,
        plan.user.publicKey
      ),
      expanded: true,
    })
  );
}

export function getFirstUnusedRelationTypeColor(
  usedColors: Array<string>
): string {
  const colors = COLORS.filter((color) => !usedColors.some((c) => c === color));
  return colors[0] || COLORS[0];
}

export function getRelationTypeByRelationsID(
  data: Data,
  relationsID: ID
): [RelationType | undefined, ID] | [undefined, undefined] {
  const relations = getRelationsNoReferencedBy(
    data.knowledgeDBs,
    relationsID,
    data.user.publicKey
  );
  if (!relations || relationsID === REFERENCED_BY) {
    return [undefined, undefined];
  }
  // Default to "relevant" type since types are now per-item
  const relationTypeID = "" as ID;

  const relationType = RELATION_TYPES.get(relationTypeID);
  return [relationType, relationTypeID];
}

// TODO: This component needs to be reworked - types are now per-item, not per-relation
export function AddNewRelationsToNodeItem({
  relationTypeID,
}: {
  relationTypeID: ID;
}): JSX.Element | null {
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const context = getContextFromStackAndViewPath(stack, viewPath);
  const { createPlan, executePlan } = usePlanner();
  const allRelationTypes = useGetAllRelationTypes();
  const relationType = allRelationTypes.get(relationTypeID, {
    color: DEFAULT_COLOR,
    label: "unknown",
  });

  const onClick = (): void => {
    if (!node) {
      throw new Error("Node not found");
    }
    const plan = planAddNewRelationToNode(
      createPlan(),
      node.id,
      context,
      view,
      viewPath
    );
    executePlan(plan);
  };

  return (
    <Dropdown.Item className="d-flex workspace-selection" onClick={onClick}>
      <div
        className="relation-type-selection-color"
        style={{
          backgroundColor: relationType.color,
        }}
      />
      <div
        className={
          relationType.label
            ? "workspace-selection-text"
            : "workspace-selection-text italic"
        }
      >
        {relationType.label || "Unnamed Type"}
      </div>
    </Dropdown.Item>
  );
}

export function AddVirtualListToNodeItem({
  virtualListID,
}: {
  virtualListID: LongID;
}): JSX.Element | null {
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const allVirtualLists = useGetAllVirtualLists();
  const virtualList = allVirtualLists.get(virtualListID, {
    color: DEFAULT_COLOR,
    label: "unknown",
  });
  const onClick = (): void => {
    if (!node) {
      throw new Error("Node not found");
    }
    const plan = planAddVirtualListToView(
      createPlan(),
      virtualListID,
      view,
      viewPath
    );
    executePlan(plan);
  };

  return (
    <Dropdown.Item className="d-flex workspace-selection" onClick={onClick}>
      <div
        className="relation-type-selection-color"
        style={{
          backgroundColor: virtualList.color,
        }}
      />
      <div className="workspace-selection-text">
        {virtualList.label || "Unnamed List"}
      </div>
    </Dropdown.Item>
  );
}
