import React, { CSSProperties } from "react";
import { Dropdown } from "react-bootstrap";
import { List } from "immutable";
import {
  addAddToNodeToPath,
  deleteChildViews,
  getAvailableRelationsForNode,
  getDefaultRelationForNode,
  updateView,
  useNode,
  useNodeID,
  useViewKey,
  useViewPath,
  viewPathToString,
} from "../ViewContext";
import {
  closeEditor,
  useDeselectAllInView,
  useTemporaryView,
} from "./TemporaryViewContext";
import { getRelations, isRemote, splitID } from "../connections";
import { REFERENCED_BY } from "../constants";
import { useData } from "../DataContext";
import { planDeleteRelations, planUpdateViews, usePlanner } from "../planner";
import {
  AddNewRelationsToNodeItem,
  AddVirtualListToNodeItem,
  RELATION_TYPES,
  getRelationTypeByRelationsID,
  planRemoveVirtualListFromView,
} from "./RelationTypes";

function AddRelationsButton(): JSX.Element {
  const [node] = useNode();
  const ariaLabel = `Add new Relations to ${node?.text || ""}`;

  const style = {
    border: "0px",
    color: "black",
    backgroundColor: "inherit",
    minHeight: "35px",
    fontSize: "1.5rem",
  };

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        className="no-shadow"
        style={style}
        aria-label={ariaLabel}
      >
        <span>+</span>
      </Dropdown.Toggle>
      <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
        {RELATION_TYPES.keySeq()
          .toArray()
          .map((id) => (
            <AddNewRelationsToNodeItem key={id} relationTypeID={id} />
          ))}
        <Dropdown.Divider />
        <AddVirtualListToNodeItem virtualListID={REFERENCED_BY} />
      </Dropdown.Menu>
    </Dropdown>
  );
}

function DeleteRelationItem({ id }: { id: LongID }): JSX.Element | null {
  const { createPlan, executePlan } = usePlanner();
  const { user, views } = useData();
  const viewPath = useViewPath();
  const [nodeID, view] = useNodeID();

  const onClick = (): void => {
    const deleteRelationsPlan = planDeleteRelations(createPlan(), id);
    // TODO: deleteChildViews should only be necessary for the deleted relation not the other
    const plan = planUpdateViews(
      deleteRelationsPlan,
      updateView(deleteChildViews(views, viewPath), viewPath, {
        ...view,
        relations: getDefaultRelationForNode(
          nodeID,
          deleteRelationsPlan.knowledgeDBs,
          user.publicKey
        ),
      })
    );
    executePlan(plan);
  };
  return (
    <Dropdown.Item onClick={onClick}>
      <span className="simple-icon-trash" />
      <span className="ms-2">Delete</span>
    </Dropdown.Item>
  );
}

function DeleteVirtualListItem({ id }: { id: LongID }): JSX.Element | null {
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const [node, view] = useNode();

  const onClick = (): void => {
    if (!node) {
      throw new Error("Node not found");
    }
    const plan = planRemoveVirtualListFromView(
      createPlan(),
      id,
      view,
      viewPath,
      node.id
    );
    executePlan(plan);
  };
  return (
    <Dropdown.Item onClick={onClick}>
      <span className="simple-icon-trash" />
      <span className="ms-2">Delete</span>
    </Dropdown.Item>
  );
}

type ChangeRelation = (relations: Relations, expand: boolean) => void;

function useOnChangeRelations(): ChangeRelation {
  const data = useData();
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const view = useNodeID()[1];
  const viewKey = useViewKey();
  const deselectAllInView = useDeselectAllInView();

  return (relations: Relations, expand: boolean): void => {
    const viewKeyOfAddToNode = addAddToNodeToPath(data, viewPath);
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        relations: relations.id,
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

function SelectOtherRelationsItem({
  relations,
}: {
  relations: Relations;
}): JSX.Element | null {
  const onChangeRelations = useOnChangeRelations();
  if (!onChangeRelations) {
    return null;
  }
  const remote = isRemote(splitID(relations.id)[0], useData().user.publicKey);
  return (
    <>
      <Dropdown.Item onClick={() => onChangeRelations(relations, true)}>
        <div>
          <span>{relations.items.size} Notes</span>
          <span>{remote && <span className="iconsminds-conference" />}</span>
        </div>
        <div>
          <span>{new Date(relations.updated * 1000).toLocaleDateString()}</span>
        </div>
      </Dropdown.Item>
    </>
  );
}

function EditRelationsDropdown({
  className,
  style,
  otherRelations,
}: {
  className: string;
  style: CSSProperties;
  otherRelations: List<Relations>;
}): JSX.Element | null {
  const view = useNodeID()[1];
  const { user } = useData();
  if (!view.relations) {
    return null;
  }

  const isRemoteRelation = isRemote(splitID(view.relations)[0], user.publicKey);

  const isDeleteAvailable =
    view.relations !== REFERENCED_BY && !isRemoteRelation;
  if (!isDeleteAvailable && otherRelations.size === 0) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        className={className}
        style={{
          ...style,
          borderLeftWidth: "0px",
          borderLeftStyle: "none",
          borderLeftColor: "none",
        }}
      >
        {isRemoteRelation && <span className="iconsminds-conference" />}
        <span className="iconsminds-gear" />
      </Dropdown.Toggle>
      <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
        {otherRelations.map((r) => (
          <SelectOtherRelationsItem key={r.id} relations={r} />
        ))}
        {otherRelations.size > 0 && isDeleteAvailable && <Dropdown.Divider />}

        {isDeleteAvailable && <DeleteRelationItem id={view.relations} />}
      </Dropdown.Menu>
    </Dropdown>
  );
}

function EditVirtualListDropdown({
  className,
  style,
}: {
  className: string;
  style: CSSProperties;
}): JSX.Element | null {
  const view = useNodeID()[1];
  if (!view.relations) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        className={className}
        aria-label="edit virtual list"
        style={{
          ...style,
          borderLeftWidth: "1px",
          borderLeftStyle: "solid",
          borderLeftColor: "white",
        }}
      >
        <span className="iconsminds-arrow-down" />
      </Dropdown.Toggle>
      <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
        <DeleteVirtualListItem id={view.relations} />
      </Dropdown.Menu>
    </Dropdown>
  );
}

type ShowRelationsButtonProps = {
  relationList: List<Relations>;
  readonly?: boolean;
  alwaysOneSelected?: boolean;
  currentSelectedRelations?: Relations;
};

function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const view = useNodeID()[1];
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  return (expand: boolean): void => {
    const viewKeyOfAddToNode = viewPathToString(
      addAddToNodeToPath(data, viewPath)
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

function AutomaticRelationsButton({
  alwaysOneSelected,
  currentRelations,
  readonly,
  relations,
  hideShowLabel,
  children,
  label,
}: {
  hideShowLabel: string;
  relations: Relations;
  readonly?: boolean;
  alwaysOneSelected?: boolean;
  currentRelations?: Relations;
  children: React.ReactNode;
  label: string;
}): JSX.Element | null {
  const view = useNode()[1];
  const onChangeRelations = useOnChangeRelations();
  const onToggleExpanded = useOnToggleExpanded();
  if (!view || !onChangeRelations || !onToggleExpanded) {
    return null;
  }
  const isSelected = currentRelations?.id === relations.id;
  const isExpanded = view.expanded === true;
  const ariaLabel =
    isExpanded && isSelected
      ? `hide ${hideShowLabel}`
      : `show ${hideShowLabel}`;
  const isActive = (isExpanded || alwaysOneSelected) && isSelected;
  const className = `btn select-relation ${
    isActive ? "opacity-none" : "deselected"
  }`;
  const style = {
    border: "0px",
    borderLeft: `2px solid black`,
    color: "black",
    backgroundColor: "inherit",
    minHeight: "25px",
  };
  const preventDeselect = isActive && alwaysOneSelected;
  const onClick = preventDeselect
    ? undefined
    : () => {
        if (view.relations === relations.id) {
          onToggleExpanded(!isExpanded);
        } else {
          onChangeRelations(relations, true);
        }
      };
  const lbl = isActive ? label : relations.items.size;
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={preventDeselect || readonly}
        style={style}
        onClick={onClick}
      >
        {children}
        <span>{lbl}</span>
      </button>
      {isActive && (
        <EditVirtualListDropdown className={className} style={style} />
      )}
    </>
  );
}

function ReferencedByRelationsButton({
  alwaysOneSelected,
  currentRelations,
  readonly,
}: {
  readonly?: boolean;
  alwaysOneSelected?: boolean;
  currentRelations?: Relations;
}): JSX.Element | null {
  const [node] = useNode();
  const { knowledgeDBs, user } = useData();
  if (!node) {
    return null;
  }
  const referencedByRelations = getRelations(
    knowledgeDBs,
    REFERENCED_BY,
    user.publicKey,
    node.id
  );
  if (!referencedByRelations) {
    return null;
  }
  return (
    <AutomaticRelationsButton
      hideShowLabel={`references to ${node.text}`}
      relations={referencedByRelations}
      readonly={readonly}
      alwaysOneSelected={alwaysOneSelected}
      currentRelations={currentRelations}
      label={`Referenced By (${referencedByRelations.items.size})`}
    >
      <span className="iconsminds-link" />
    </AutomaticRelationsButton>
  );
}

function sortRelations(
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

function relationLabel(
  isActive: boolean,
  relationType: RelationType | undefined,
  relationSize: number
): string {
  if (!isActive) {
    return relationSize === 0 ? "" : `${relationSize}`;
  }
  if (!relationType) {
    return `Unknown (${relationSize})`;
  }
  if (relationType.label === "") {
    return relationSize === 0 ? "" : `${relationSize}`;
  }
  return `${relationType.label} (${relationSize})`;
}

function SelectRelationsButton({
  relationList,
  readonly: ro,
  alwaysOneSelected,
  currentSelectedRelations,
}: ShowRelationsButtonProps): JSX.Element | null {
  const [node, view] = useNode();
  const data = useData();
  const readonly = ro === true;
  const onChangeRelations = useOnChangeRelations();
  const onToggleExpanded = useOnToggleExpanded();
  if (!node || !view || !onChangeRelations) {
    return null;
  }
  const isSelected =
    relationList.filter((r) => r.id === currentSelectedRelations?.id).size > 0;
  const sorted = sortRelations(relationList, data.user.publicKey);
  const topRelation = isSelected ? currentSelectedRelations : sorted.first();
  if (!topRelation) {
    return null;
  }
  const otherRelations = sorted.filter((r) => r.id !== topRelation.id);
  const [relationType] = getRelationTypeByRelationsID(data, topRelation.id);
  const relationSize = topRelation.items.size;

  if (readonly) {
    return (
      <div className="flex-start deselected">
        <span className="font-size-small pe-1">{relationSize}</span>
      </div>
    );
  }

  const isExpanded = view.expanded === true;
  const ariaLabel =
    isExpanded && isSelected
      ? `hide items ${relationType?.invertedRelationLabel || "list"} ${
          node.text
        }`
      : `show items ${relationType?.invertedRelationLabel || "list"} ${
          node.text
        }`;

  const isActive = (isExpanded || !!alwaysOneSelected) && isSelected;
  const className = `btn select-relation no-shadow ${
    isActive ? "opacity-none" : "deselected"
  }`;

  const color = relationType?.color || "black";
  const style = {
    borderTopColor: color,
    borderRightColor: color,
    border: "0px",
    borderLeft: `2px solid ${color}`,
    color,
    backgroundColor: "inherit",
  };
  const label = relationLabel(isActive, relationType, relationSize);
  const preventDeselect = isActive && alwaysOneSelected;
  const onClick = preventDeselect
    ? undefined
    : () => {
        if (view.relations === topRelation.id) {
          onToggleExpanded(!isExpanded);
        } else {
          onChangeRelations(topRelation, true);
        }
      };
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        style={style}
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {isActive && (
        <EditRelationsDropdown
          className={className}
          style={style}
          otherRelations={otherRelations}
        />
      )}
    </>
  );
}

export function SelectRelations({
  readonly,
  alwaysOneSelected,
}: {
  readonly?: boolean;
  alwaysOneSelected?: boolean;
}): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [nodeID, view] = useNodeID();
  const displayReferencedByRelationsButton =
    view.virtualLists && view.virtualLists.includes(REFERENCED_BY);
  const currentRelations = getRelations(
    knowledgeDBs,
    view.relations,
    user.publicKey,
    nodeID
  );
  const relations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID
  );

  const groupedByType = relations
    .groupBy((r) => r.type)
    .sortBy((r, t) => (currentRelations?.type === t ? 0 : 1));

  return (
    <div className="menu-layout font-size-small">
      <ul className="nav nav-underline gap-0">
        {groupedByType.toArray().map(([type, r]) => (
          <SelectRelationsButton
            relationList={r.toList()}
            readonly={readonly}
            alwaysOneSelected={alwaysOneSelected}
            currentSelectedRelations={currentRelations}
            key={type}
          />
        ))}
        {displayReferencedByRelationsButton && (
          <ReferencedByRelationsButton
            readonly={readonly}
            alwaysOneSelected={alwaysOneSelected}
            currentRelations={currentRelations}
          />
        )}
        {!readonly && <AddRelationsButton />}
      </ul>
    </div>
  );
}
