import React, { CSSProperties } from "react";
import { Dropdown, OverlayTrigger, Tooltip } from "react-bootstrap";
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

function OtherVersionsDots({
  count,
  color,
}: {
  count: number;
  color: string;
}): JSX.Element {
  const maxDots = 3;
  const showPlus = count > maxDots;
  const dotsToShow = showPlus ? maxDots - 1 : count;

  if (count === 0) {
    return <div className="other-versions-dots" />;
  }

  const label = count === 1 ? "1 other version" : `${count} other versions`;

  return (
    <div className="other-versions-dots" role="img" aria-label={label}>
      {Array.from({ length: dotsToShow }).map((_, i) => (
        <div
          // Dots are identical and list never reorders
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="dot"
          style={{ backgroundColor: color }}
        />
      ))}
      {showPlus && (
        <span className="plus" style={{ color }}>
          +
        </span>
      )}
    </div>
  );
}

function RelationButton({
  color,
  label,
  onClick,
  ariaLabel,
  id,
  count,
  isActive,
  disabled,
  showTooltip,
  tooltipLabel,
  showVertical = true,
  addGroupSpacing = false,
  otherVersionsCount = 0,
}: {
  color: string;
  label: string;
  onClick?: () => void;
  ariaLabel: string;
  id: string;
  count?: number;
  isActive?: boolean;
  disabled?: boolean;
  showTooltip?: boolean;
  tooltipLabel?: string;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
  otherVersionsCount?: number;
}): JSX.Element {
  const buttonStyle = showVertical
    ? {
      border: "0px",
      backgroundColor: "inherit",
      padding: "0 4px",
      position: "relative" as const,
      minWidth: "12px",
      minHeight: "25px",
      height: "100%",
      color,
      display: "flex",
      alignItems: "flex-start",
      marginRight: addGroupSpacing ? "8px" : undefined,
    }
    : {
      border: "0px",
      backgroundColor: "inherit",
      padding: "4px 0",
      minWidth: "25px",
      color,
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      marginRight: addGroupSpacing ? "8px" : undefined,
    };

  const lineStyleVertical = {
    width: "2px",
    backgroundColor: color,
    height: "100%",
    position: "absolute" as const,
    left: "0",
    top: "0",
  };

  const lineStyleHorizontal = {
    width: "100%",
    height: "3px",
    backgroundColor: color,
    marginTop: "2px",
    marginBottom: "2px",
  };

  const countStyle = {
    fontSize: "10px",
  };

  const labelStyle = {};

  const verticalContentStyle = {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    marginLeft: "4px",
  };

  const dots = <OtherVersionsDots count={otherVersionsCount} color={color} />;

  const getCountOrLabel = (): JSX.Element => {
    if (isActive) {
      return <span style={labelStyle}>{label}</span>;
    }
    if (count !== undefined && count > 0) {
      return <span style={countStyle}>{count}</span>;
    }
    return <span style={countStyle}>&nbsp;</span>;
  };
  const countOrLabel = getCountOrLabel();

  return (
    <ConditionalTooltip
      show={showTooltip !== false && !isActive}
      label={tooltipLabel || label}
      id={id}
    >
      <button
        type="button"
        onClick={onClick}
        style={buttonStyle}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {showVertical ? (
          <>
            <div style={lineStyleVertical} />
            <div style={verticalContentStyle}>
              {countOrLabel}
              {dots}
            </div>
          </>
        ) : (
          <>
            {dots}
            <div style={lineStyleHorizontal} />
            {countOrLabel}
          </>
        )}
      </button>
    </ConditionalTooltip>
  );
}

function GhostRelationButton({
  relationTypeID,
  showVertical,
  addGroupSpacing,
}: {
  relationTypeID: ID;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
}): JSX.Element {
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const context = getContextFromStackAndViewPath(stack, viewPath);
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
      context,
      view,
      viewPath
    );
    executePlan(plan);
  };

  return (
    <RelationButton
      color={relationType.color}
      label={relationType.label}
      onClick={onClick}
      ariaLabel={`create ${relationType.label || "relation"} for ${node?.text || "node"
        }`}
      id={relationTypeID}
      showVertical={showVertical}
      addGroupSpacing={addGroupSpacing}
    />
  );
}

function GhostVirtualListButton({
  virtualListID,
  showVertical,
  addGroupSpacing,
}: {
  virtualListID: LongID;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
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
    <RelationButton
      color="black"
      label={virtualList.label}
      onClick={onClick}
      ariaLabel={`add ${virtualList.label || "virtual list"}`}
      id={virtualListID}
      showVertical={showVertical}
      addGroupSpacing={addGroupSpacing}
    />
  );
}

type ChangeRelation = (relations: Relations, expand: boolean) => void;

export function useOnChangeRelations(): ChangeRelation {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const view = useNodeID()[1];
  const viewKey = useViewKey();
  const deselectAllInView = useDeselectAllInView();

  return (relations: Relations, expand: boolean): void => {
    const viewKeyOfAddToNode = addAddToNodeToPath(data, viewPath, stack);
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
          <span>{remote && <span className="iconsminds-business-man" />}</span>
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
  if (!view.relations || otherRelations.size === 0) {
    return null;
  }

  const isRemoteRelation = isRemote(splitID(view.relations)[0], user.publicKey);

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
        {isRemoteRelation && <span className="iconsminds-business-man" />}
        <span className="iconsminds-gear" />
      </Dropdown.Toggle>
      <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
        {otherRelations.map((r) => (
          <SelectOtherRelationsItem key={r.id} relations={r} />
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

type ShowRelationsButtonProps = {
  relationList: List<Relations>;
  alwaysOneSelected?: boolean;
  currentSelectedRelations?: Relations;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
};

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

function AutomaticRelationsButton({
  alwaysOneSelected,
  currentRelations,
  relations,
  hideShowLabel,
  label,
  showVertical,
  addGroupSpacing,
}: {
  hideShowLabel: string;
  relations: Relations;
  alwaysOneSelected?: boolean;
  currentRelations?: Relations;
  label: string;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
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

  return (
    <RelationButton
      color="black"
      label={label}
      onClick={onClick}
      ariaLabel={ariaLabel}
      id={relations.id}
      count={relations.items.size}
      isActive={isActive}
      disabled={preventDeselect}
      showVertical={showVertical}
      addGroupSpacing={addGroupSpacing}
    />
  );
}

function ReferencedByRelationsButton({
  alwaysOneSelected,
  currentRelations,
  showVertical,
  addGroupSpacing,
}: {
  alwaysOneSelected?: boolean;
  currentRelations?: Relations;
  showVertical?: boolean;
  addGroupSpacing?: boolean;
}): JSX.Element | null {
  const [node] = useNode();
  const { knowledgeDBs, user } = useData();
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
  if (!referencedByRelations) {
    return null;
  }
  return (
    <AutomaticRelationsButton
      hideShowLabel={`references to ${node.text}`}
      relations={referencedByRelations}
      alwaysOneSelected={alwaysOneSelected}
      currentRelations={currentRelations}
      label={`Referenced By (${referencedByRelations.items.size})`}
      showVertical={showVertical}
      addGroupSpacing={addGroupSpacing}
    />
  );
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
  alwaysOneSelected,
  currentSelectedRelations,
  showVertical,
  addGroupSpacing,
}: ShowRelationsButtonProps): JSX.Element | null {
  const [node, view] = useNode();
  const data = useData();
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

  // Count how many OTHER users have versions of this relation type
  const otherVersionsCount = relationList.filter((r) =>
    isRemote(splitID(r.id)[0], data.user.publicKey)
  ).size;

  const isExpanded = view.expanded === true;
  const ariaLabel =
    isExpanded && isSelected
      ? `hide items ${relationType?.invertedRelationLabel || "list"} ${node.text
      }`
      : `show items ${relationType?.invertedRelationLabel || "list"} ${node.text
      }`;

  const isActive = (isExpanded || !!alwaysOneSelected) && isSelected;
  const className = `btn select-relation no-shadow ${isActive ? "opacity-none" : "deselected"
    }`;

  const color = relationType?.color || "black";
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

  const dropdownStyle = {
    borderTopColor: color,
    borderRightColor: color,
    border: "0px",
    borderLeft: `2px solid ${color}`,
    color,
    backgroundColor: "inherit",
  };

  const button = (
    <RelationButton
      color={color}
      label={label}
      onClick={onClick}
      ariaLabel={ariaLabel}
      id={topRelation.id}
      count={relationSize}
      isActive={isActive}
      showTooltip={!isActive}
      tooltipLabel={relationType?.label || "relation"}
      showVertical={showVertical}
      addGroupSpacing={addGroupSpacing}
      otherVersionsCount={otherVersionsCount}
    />
  );

  if (!isActive) {
    return button;
  }

  return (
    <span style={{ display: "flex" }}>
      {button}
      <EditRelationsDropdown
        className={className}
        style={dropdownStyle}
        otherRelations={otherRelations}
      />
    </span>
  );
}

export function SelectRelations({
  alwaysOneSelected,
}: {
  alwaysOneSelected?: boolean;
}): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [nodeID, view] = useNodeID();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const context = getContextFromStackAndViewPath(stack, viewPath);
  const currentRelations = getRelations(
    knowledgeDBs,
    view.relations,
    user.publicKey,
    nodeID
  );
  const relations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID,
    context
  );

  // Determine if we should show vertical or horizontal bars
  // Root always shows vertical, regular notes: horizontal by default, vertical when expanded
  // Note: viewPath[0] is pane index, so length 2 = [paneIndex, root]
  const isRoot = viewPath.length === 2;
  const showVertical = alwaysOneSelected || isRoot || view.expanded === true;
  const forceOneSelected = alwaysOneSelected || isRoot;

  // Since types are now per-item, show all relations as a single list
  // along with Referenced By option
  const hasRelations = relations.size > 0;

  return (
    <div className="menu-layout font-size-small">
      <ul className="nav nav-underline gap-0">
        {/* Show existing relations or ghost button to create new */}
        {hasRelations ? (
          <SelectRelationsButton
            relationList={relations}
            alwaysOneSelected={forceOneSelected}
            currentSelectedRelations={currentRelations}
            showVertical={showVertical}
            addGroupSpacing={false}
          />
        ) : (
          <GhostRelationButton
            relationTypeID={"" as ID}
            showVertical={showVertical}
            addGroupSpacing={false}
          />
        )}
        {/* Referenced By toggle */}
        <ReferencedByRelationsButton
          alwaysOneSelected={forceOneSelected}
          currentRelations={currentRelations}
          showVertical={showVertical}
          addGroupSpacing={false}
        />
      </ul>
    </div>
  );
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
  const ariaLabel = isInReferencedBy && isExpanded
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
