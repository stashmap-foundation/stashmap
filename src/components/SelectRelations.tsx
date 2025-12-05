import React, { CSSProperties } from "react";
import { Dropdown, OverlayTrigger, Tooltip } from "react-bootstrap";
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
  RELATION_TYPES,
  VIRTUAL_LISTS,
  getRelationTypeByRelationsID,
  planAddNewRelationToNode,
  planAddVirtualListToView,
} from "./RelationTypes";

const tooltipConfig = {
  modifiers: [],
};

function ConditionalTooltip({
  show,
  label,
  id,
  children,
}: {
  show: boolean;
  label: string;
  id: string;
  children: React.ReactElement;
}): JSX.Element {
  if (!show) {
    return children;
  }

  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip id={`tooltip-${id}`}>{label}</Tooltip>}
      popperConfig={tooltipConfig}
    >
      {children}
    </OverlayTrigger>
  );
}

function GhostButton({
  color,
  label,
  onClick,
  ariaLabel,
  id,
}: {
  color: string;
  label: string;
  onClick: () => void;
  ariaLabel: string;
  id: string;
}): JSX.Element {
  const style = {
    border: "0px",
    borderLeft: `2px solid ${color}`,
    color,
    backgroundColor: "inherit",
    opacity: 0.3,
    width: "12px",
    minHeight: "25px",
    padding: 0,
  };

  return (
    <ConditionalTooltip show label={label} id={id}>
      <button
        type="button"
        onClick={onClick}
        style={style}
        aria-label={ariaLabel}
      >
        {" "}
      </button>
    </ConditionalTooltip>
  );
}

function GhostRelationButton({
  relationTypeID,
}: {
  relationTypeID: ID;
}): JSX.Element {
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const relationType = RELATION_TYPES.get(relationTypeID, {
    color: "black",
    label: "",
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
    <GhostButton
      color={relationType.color}
      label={relationType.label}
      onClick={onClick}
      ariaLabel={`create ${relationType.label || "relation"}`}
      id={relationTypeID}
    />
  );
}

function GhostVirtualListButton({
  virtualListID,
}: {
  virtualListID: LongID;
}): JSX.Element {
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const virtualList = VIRTUAL_LISTS.get(virtualListID, {
    color: "black",
    label: "",
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
    <GhostButton
      color="black"
      label={virtualList.label}
      onClick={onClick}
      ariaLabel={`add ${virtualList.label || "virtual list"}`}
      id={virtualListID}
    />
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
    <ConditionalTooltip show={!isActive} label={label} id={relations.id}>
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
    </ConditionalTooltip>
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
    <ConditionalTooltip
      show={!isActive}
      label={relationType?.label || "relation"}
      id={topRelation.id}
    >
      <span style={{ display: "flex" }}>
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
      </span>
    </ConditionalTooltip>
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

  const groupedByType = relations.groupBy((r) => r.type);

  const allItems: { type: string; id: LongID }[] = [
    ...RELATION_TYPES.keySeq()
      .toArray()
      .map((id) => ({ type: "relation" as const, id: id as LongID })),
    ...VIRTUAL_LISTS.keySeq()
      .toArray()
      .map((id) => ({ type: "virtualList" as const, id: id as LongID })),
  ];

  const sortedItems = [...allItems].sort((a, b) => {
    const isCurrentA =
      a.type === "relation"
        ? currentRelations?.type === a.id
        : view.relations === a.id;
    const isCurrentB =
      b.type === "relation"
        ? currentRelations?.type === b.id
        : view.relations === b.id;

    if (isCurrentA) return -1;
    if (isCurrentB) return 1;
    return 0;
  });

  return (
    <div className="menu-layout font-size-small">
      <ul className="nav nav-underline gap-0">
        {sortedItems.map((item) => {
          if (item.type === "relation") {
            const relationsOfType = groupedByType.get(item.id);
            if (relationsOfType) {
              return (
                <SelectRelationsButton
                  relationList={relationsOfType.toList()}
                  readonly={readonly}
                  alwaysOneSelected={alwaysOneSelected}
                  currentSelectedRelations={currentRelations}
                  key={item.id}
                />
              );
            }
            if (readonly) {
              return null;
            }
            return (
              <GhostRelationButton relationTypeID={item.id} key={item.id} />
            );
          }
          if (item.id === REFERENCED_BY) {
            return (
              <ReferencedByRelationsButton
                readonly={readonly}
                alwaysOneSelected={alwaysOneSelected}
                currentRelations={currentRelations}
                key={item.id}
              />
            );
          }
          if (readonly) {
            return null;
          }
          return (
            <GhostVirtualListButton virtualListID={item.id} key={item.id} />
          );
        })}
      </ul>
    </div>
  );
}
