import React from "react";
import { Dropdown } from "react-bootstrap";
import { List } from "immutable";
import {
  addAddToNodeToPath,
  getAvailableRelationsForNode,
  getContextFromStackAndViewPath,
  updateView,
  useNode,
  useNodeID,
  useViewKey,
  useViewPath,
  viewPathToString,
} from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";
import {
  closeEditor,
  useDeselectAllInView,
  useTemporaryView,
} from "./TemporaryViewContext";
import {
  getRelations,
  isRemote,
  splitID,
  isReferenceNode,
} from "../connections";
import { REFERENCED_BY } from "../constants";
import { useData } from "../DataContext";
import { planUpdateViews, usePlanner } from "../planner";

type ChangeRelation = (
  relations: Relations | undefined,
  expand: boolean
) => void;

export function useOnChangeRelations(): ChangeRelation {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const view = useNodeID()[1];
  const viewKey = useViewKey();
  const deselectAllInView = useDeselectAllInView();

  return (relations: Relations | undefined, expand: boolean): void => {
    const viewKeyOfAddToNode = addAddToNodeToPath(data, viewPath, stack);
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        relations: relations?.id,
        expanded: expand,
      })
    );
    executePlan(plan);
    setEditorOpenState(
      closeEditor(editorOpenViews, viewPathToString(viewKeyOfAddToNode))
    );
    deselectAllInView(viewKey);
  };
}

export function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const view = useNodeID()[1];
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  return (expand: boolean): void => {
    const viewKeyOfAddToNode = viewPathToString(
      addAddToNodeToPath(data, viewPath, stack)
    );
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        expanded: expand,
      })
    );
    executePlan(plan);
    if (!expand) {
      setEditorOpenState(closeEditor(editorOpenViews, viewKeyOfAddToNode));
    }
  };
}

export function sortRelations(
  relationList: List<Relations>,
  myself: PublicKey
): List<Relations> {
  return relationList.sort((rA, rB) => {
    // Sort by date, but the one relation which is not remote comes always first
    if (!isRemote(splitID(rA.id)[0], myself)) {
      return -1;
    }
    if (!isRemote(splitID(rB.id)[0], myself)) {
      return 1;
    }
    return rB.updated - rA.updated;
  });
}

export function VersionSelector(): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [nodeID, view] = useNodeID();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const onChangeRelations = useOnChangeRelations();

  const context = getContextFromStackAndViewPath(stack, viewPath);
  const currentRelations = getRelations(
    knowledgeDBs,
    view.relations,
    user.publicKey,
    nodeID
  );
  const allRelations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID,
    context
  );

  // Only show when there are multiple relations to choose from
  if (allRelations.size <= 1) {
    return null;
  }

  const sorted = sortRelations(allRelations, user.publicKey);
  const otherRelations = sorted.filter((r) => r.id !== currentRelations?.id);

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        className="btn btn-borderless p-0"
        aria-label={`${allRelations.size} versions available`}
      >
        <span className="iconsminds-clock-back" />
      </Dropdown.Toggle>
      <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
        {otherRelations.map((r) => {
          const remote = isRemote(splitID(r.id)[0], user.publicKey);
          return (
            <Dropdown.Item
              key={r.id}
              onClick={() => onChangeRelations(r, true)}
            >
              <div className="d-flex justify-content-between align-items-center">
                <span>{r.items.size} Notes</span>
                {remote && <span className="iconsminds-business-man ms-2" />}
              </div>
              <div className="font-size-small text-muted">
                {new Date(r.updated * 1000).toLocaleDateString()}
              </div>
            </Dropdown.Item>
          );
        })}
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function ReferencedByToggle(): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [node] = useNode();
  const [nodeID, view] = useNodeID();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const onChangeRelations = useOnChangeRelations();

  if (!node) {
    return null;
  }

  // Don't show Referenced By for Reference nodes (they are synthetic)
  if (isReferenceNode(node)) {
    return null;
  }

  const referencedByRelations = getRelations(
    knowledgeDBs,
    REFERENCED_BY,
    user.publicKey,
    node.id
  );

  // Don't show if no references
  if (!referencedByRelations || referencedByRelations.items.size === 0) {
    return null;
  }

  const isInReferencedBy = view.relations === REFERENCED_BY;
  const isExpanded = view.expanded === true;

  // Get the top normal relation to switch back to
  const context = getContextFromStackAndViewPath(stack, viewPath);
  const normalRelations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID,
    context
  );
  const sorted = sortRelations(normalRelations, user.publicKey);
  const topNormalRelation = sorted.first();

  const onClick = (): void => {
    if (isInReferencedBy) {
      if (isExpanded && topNormalRelation) {
        // Switch back to normal relations
        onChangeRelations(topNormalRelation, true);
      } else if (!isExpanded) {
        // Just expand Referenced By view
        onChangeRelations(referencedByRelations, true);
      }
    } else {
      // Switch to Referenced By
      onChangeRelations(referencedByRelations, true);
    }
  };

  // Match old behavior: show "hide" only when both selected AND expanded
  const ariaLabel =
    isInReferencedBy && isExpanded
      ? `hide references to ${node.text}`
      : `show references to ${node.text}`;

  return (
    <button
      type="button"
      className={`btn btn-borderless p-0 ${isInReferencedBy ? "active" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={isInReferencedBy ? "Show children" : "Show references"}
    >
      <span className="iconsminds-link-2" />
      <span className="ms-1 font-size-small">
        {referencedByRelations.items.size}
      </span>
    </button>
  );
}
