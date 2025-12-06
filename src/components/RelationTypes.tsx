import React from "react";
import { Dropdown } from "react-bootstrap";
import { OrderedMap, Set } from "immutable";
import {
  Plan,
  planUpdateViews,
  planUpsertRelations,
  usePlanner,
} from "../planner";
import { getRelationsNoReferencedBy } from "../connections";
import { REFERENCED_BY } from "../constants";
import {
  ViewPath,
  getDefaultRelationForNode,
  newRelations,
  updateView,
  useNode,
  useViewPath,
} from "../ViewContext";

export const DEFAULT_COLOR = "#027d86";

export const COLORS = [
  "#9c27b0",
  "#673ab7",
  "#3f51b5",
  "#032343",
  "#738dbb",
  "#2196f3",
  "#00bcd4",
  "#009688",
  "#4caf50",
  "#8bc34a",
  "#a1cb58",
  "#e7c550",
  "#ffc859",
  "#ff9800",
  "#8f2c3b",
  "#c30202",
  "#bf4d3e",
  "#795548",
];

// Semantic grouping: Relevance types, Evidence types, Structure types
export const RELATION_TYPES = OrderedMap<RelationType>({
  // Relevance group - Green/Teal spectrum
  "": {
    color: "#00897b", // Strong teal
    label: "relevant to",
    invertedRelationLabel: "relevant for",
  },
  maybe_relevant: {
    color: "#26a69a", // Medium teal
    label: "maybe relevant to",
    invertedRelationLabel: "maybe relevant for",
  },
  little_relevant: {
    color: "#80cbc4", // Light teal
    label: "little relevant to",
    invertedRelationLabel: "little relevant for",
  },
  not_relevant: {
    color: "#9e9e9e", // Gray
    label: "not relevant to",
    invertedRelationLabel: "not relevant for",
  },
  // Evidence group
  confirms: {
    color: "#43a047", // Strong green
    label: "confirmed by",
    invertedRelationLabel: "confirms",
  },
  contra: {
    color: "#e53935", // Strong red
    label: "contradicted by",
    invertedRelationLabel: "contradicts",
  },
  // Structure group
  contains: {
    color: "#3949ab", // Strong indigo
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
  nodeID: LongID,
  relationTypeID: ID,
  view: View,
  viewPath: ViewPath
): Plan {
  const relations = newRelations(nodeID, relationTypeID, plan.user.publicKey);
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
  const relationTypeID = relations.type;

  const relationType = RELATION_TYPES.get(relationTypeID);
  return [relationType, relationTypeID];
}

export function AddNewRelationsToNodeItem({
  relationTypeID,
}: {
  relationTypeID: ID;
}): JSX.Element | null {
  const [node, view] = useNode();
  const viewPath = useViewPath();
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
      relationTypeID,
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
