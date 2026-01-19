import { List } from "immutable";
import React from "react";
import { useMediaQuery } from "react-responsive";
import { Link } from "react-router-dom";
import {
  useNode,
  useViewPath,
  ViewPath,
  useIsInReferencedByView,
  useIsExpanded,
  useIsRoot,
  addNodeToPathWithRelations,
  addDiffItemToPath,
  getDiffItemsForNode,
  getNodeIDFromView,
  useNodeID,
  getContextFromStackAndViewPath,
  getAvailableRelationsForNode,
  findOrCreateRelationsForContext,
  usePreviousSibling,
  getViewFromPath,
} from "../ViewContext";
import {
  NodeSelectbox,
  useIsParentMultiselectBtnOn,
  isMutableNode,
} from "./TemporaryViewContext";
import {
  getReferencedByRelations,
  getRelations,
  isReferenceNode,
  getRefTargetStack,
  itemMatchesType,
} from "../connections";
import { REFERENCED_BY, DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";
import { IS_MOBILE } from "./responsive";
import { MiniEditor } from "./AddNode";
import {
  sortRelations,
  useOnChangeRelations,
  useOnToggleExpanded,
} from "./SelectRelations";
import { ReferenceIndicators } from "./ReferenceIndicators";
import { useData } from "../DataContext";
import { planUpsertNode, usePlanner } from "../planner";
import { planDisconnectFromParent, planAddToParent } from "../dnd";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeIcon } from "./NodeIcon";
import {
  planAddNewRelationToNode,
  planExpandNode,
  planExpandAndOpenCreateNodeEditor,
} from "./RelationTypes";
import { NodeCard } from "../commons/Ui";
import { useProjectContext } from "../ProjectContext";
import { usePaneNavigation } from "../SplitPanesContext";
import { LeftMenu } from "./LeftMenu";
import { RightMenu } from "./RightMenu";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { useItemStyle } from "./useItemStyle";

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const data = useData();
  const viewPath = useViewPath();
  const [node] = useNode();
  const [nodeID, view] = useNodeID();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const onChangeRelations = useOnChangeRelations();
  const onToggleExpanded = useOnToggleExpanded();
  const isReferencedBy = view.relations === REFERENCED_BY;

  const isExpanded = useIsExpanded();

  // Get available relations filtered by context (same as SelectRelations)
  const context = getContextFromStackAndViewPath(stack, viewPath);
  const availableRelations = getAvailableRelationsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    nodeID,
    context
  );
  const hasRelations = availableRelations.size > 0;

  // Get current relations (same as SelectRelations)
  const currentRelations = getRelations(
    data.knowledgeDBs,
    view.relations,
    data.user.publicKey,
    nodeID
  );

  // Determine topRelation (same logic as SelectRelationsButton)
  const isSelected =
    availableRelations.filter((r) => r.id === currentRelations?.id).size > 0;
  const sorted = sortRelations(availableRelations, data.user.publicKey);
  const topRelation = isSelected ? currentRelations : sorted.first();

  // Get color based on view state: purple for Referenced By, black for normal
  const color = isReferencedBy ? TYPE_COLORS.referenced_by : "black";

  const onToggle = (): void => {
    if (hasRelations && topRelation) {
      // Has existing relations (same as SelectRelationsButton onClick)
      if (view.relations === topRelation.id) {
        // Toggle expanded state
        onToggleExpanded(!isExpanded);
      } else {
        // Change to the correct relation and expand
        onChangeRelations(topRelation, true);
      }
    } else {
      // No relations exist, create new (same as GhostRelationButton onClick)
      if (!node) {
        return;
      }
      const plan = planAddNewRelationToNode(
        createPlan(),
        node.id,
        context,
        view,
        viewPath
      );
      executePlan(plan);
    }
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      className="expand-collapse-toggle"
      aria-label={
        isExpanded ? `collapse ${node?.text}` : `expand ${node?.text}`
      }
      aria-expanded={isExpanded}
      style={{
        color,
        backgroundColor: isReferencedBy
          ? "rgba(100, 140, 180, 0.1)"
          : undefined,
      }}
    >
      <span className={`triangle ${isExpanded ? "expanded" : "collapsed"}`}>
        {isExpanded ? "▼" : "▶"}
      </span>
    </button>
  );
}

export function LoadingNode(): JSX.Element {
  return (
    <div className="ph-item">
      <div>
        <div className="ph-row">
          <div className="ph-col-8" />
          <div className="ph-col-12 " />
          <div className="ph-col-4" />
        </div>
      </div>
    </div>
  );
}

function ErrorContent(): JSX.Element {
  return (
    <div>
      <b>Error: Node not found</b>
      <p>The node you requested could not be found. Possible reasons are:</p>
      <ul>
        <li>You do not have permission to see this node.</li>
        <li>The node has been deleted.</li>
      </ul>
      <p>Please check your permissions and try again.</p>
    </div>
  );
}

function NodeContent({ node }: { node: KnowNode }): JSX.Element {
  const isReference = node.type === "reference";

  // Reference nodes get special link-like styling
  const referenceStyle: React.CSSProperties = isReference
    ? {
        fontStyle: "italic",
        color: "#5a7bad",
        textDecoration: "none",
        borderBottom: "1px dotted #8fadd4",
      }
    : {};

  return (
    <span className={`break-word ${isReference ? "reference-node" : ""}`}>
      <NodeIcon node={node} />
      {isReference && <ReferenceIndicators refId={node.id} />}
      <span style={referenceStyle}>{node.text}</span>
    </span>
  );
}

function EditableContent(): JSX.Element {
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const [node] = useNode();
  const [nodeID] = useNodeID();
  const prevSibling = usePreviousSibling();

  const handleSave = (text: string, _imageUrl?: string, submitted?: boolean): void => {
    if (!node || node.type !== "text") return;
    const textChanged = text !== node.text;

    let plan = createPlan();

    // Save text changes if any
    if (textChanged) {
      plan = planUpsertNode(plan, {
        ...node,
        text,
      });
    }

    // If user pressed Enter, open create node editor (position determined by expansion state)
    if (submitted) {
      plan = planExpandAndOpenCreateNodeEditor(plan, viewPath, stack);
    }

    // Only execute if something changed
    if (textChanged || submitted) {
      executePlan(plan);
    }
  };

  const handleTab = (text: string): void => {
    if (!prevSibling || !node || node.type !== "text") {
      return;
    }

    const basePlan = createPlan();

    // Step 1: Save text changes if any
    const planWithText =
      text !== node.text
        ? planUpsertNode(basePlan, {
            ...node,
            text,
          })
        : basePlan;

    // Step 2: Expand the previous sibling (ensure it has relations)
    const context = getContextFromStackAndViewPath(stack, prevSibling.viewPath);
    const planWithExpand = planExpandNode(
      planWithText,
      prevSibling.nodeID,
      context,
      prevSibling.view,
      prevSibling.viewPath
    );

    // Step 3: Disconnect current node from current parent
    const planWithDisconnect = planDisconnectFromParent(
      planWithExpand,
      viewPath,
      stack
    );

    // Step 4: Add current node to previous sibling at end
    const finalPlan = planAddToParent(
      planWithDisconnect,
      nodeID,
      prevSibling.viewPath,
      stack
    );

    executePlan(finalPlan);
  };

  // For non-text nodes, show read-only content
  if (!node || node.type !== "text") {
    return <NodeContent node={node!} />;
  }

  return (
    <MiniEditor
      initialText={node.text}
      onSave={handleSave}
      onTab={handleTab}
      autoFocus={false}
      ariaLabel={`edit ${node.text}`}
    />
  );
}

function InteractiveNodeContent(): JSX.Element {
  const { user } = useData();
  const [node] = useNode();
  const [, view] = useNodeID();
  const isLoading = useNodeIsLoading();
  const isInReferencedByView = useIsInReferencedByView();
  // Also check if this is the root node of a Referenced By view
  const isReferencedByRoot = view.relations === REFERENCED_BY;

  if (isLoading) {
    return <LoadingNode />;
  }

  if (!node) {
    return <ErrorContent />;
  }

  // Editable content for mutable nodes (but read-only in Referenced By view)
  if (
    isMutableNode(node, user) &&
    !isInReferencedByView &&
    !isReferencedByRoot
  ) {
    return <EditableContent />;
  }

  // Read-only content
  return <NodeContent node={node} />;
}

function NodeAutoLink({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { bookmarkedProjects } = useProjectContext();
  const { setStack } = usePaneNavigation();
  const [nodeID] = useNodeID();
  const [node] = useNode();

  // Reference nodes navigate to their target location when clicked
  if (node && isReferenceNode(node)) {
    const targetStack = getRefTargetStack(node.id);
    if (targetStack) {
      const handleClick = (): void => {
        setStack(targetStack);
      };
      return (
        <button
          type="button"
          className="reference-link-btn"
          onClick={handleClick}
          aria-label={`Navigate to ${node.text}`}
        >
          {children}
        </button>
      );
    }
  }

  if (node && node.type === "project") {
    const project = node as ProjectNode;
    if (bookmarkedProjects.find((bookmark) => bookmark === nodeID)) {
      if (project.dashboardInternal) {
        return (
          <Link
            className="no-underline"
            to={`/w/${escape(project.dashboardInternal)}?p=${escape(
              project.id
            )}`}
          >
            {children}
          </Link>
        );
      }
    }
  }

  return <>{children}</>;
}

const INDENTATION = 25;
const ARROW_WIDTH = 0;

export function Indent({
  levels,
  backgroundColorForLast,
}: {
  levels: number;
  backgroundColorForLast?: string;
}): JSX.Element {
  // Simple indentation without vertical lines
  return (
    <>
      {Array.from(Array(levels).keys()).map((k) => {
        const marginLeft = k === 0 ? 5 : ARROW_WIDTH;
        const width = k === 0 ? 0 : INDENTATION;
        const isLast = k === levels - 1;
        const backgroundColor = isLast ? backgroundColorForLast : undefined;

        return (
          <div
            key={k}
            style={{ marginLeft, backgroundColor, alignSelf: "stretch" }}
          >
            <div style={{ width }} />
          </div>
        );
      })}
    </>
  );
}

export function getNodesInTree(
  data: Data,
  parentPath: ViewPath,
  stack: (LongID | ID)[],
  ctx: List<ViewPath>,
  noExpansion?: boolean
): List<ViewPath> {
  const [parentNodeID, parentView] = getNodeIDFromView(data, parentPath);

  // Handle REFERENCED_BY specially - it's not context-based
  if (parentView.relations === REFERENCED_BY) {
    const referencedByRelations = getReferencedByRelations(
      data.knowledgeDBs,
      data.user.publicKey,
      parentNodeID
    );
    if (!referencedByRelations || referencedByRelations.items.size === 0) {
      return ctx;
    }
    // Referenced By items are readonly - no expansion, no diff items, no add node
    const childPaths = referencedByRelations.items.map((_, i) =>
      addNodeToPathWithRelations(parentPath, referencedByRelations, i)
    );
    return ctx.concat(childPaths);
  }

  const context = getContextFromStackAndViewPath(stack, parentPath);
  const relations = findOrCreateRelationsForContext(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID,
    context,
    parentView.relations
  );

  if (!relations) {
    return ctx;
  }

  // Filter items based on view's typeFilters (default filters out "not_relevant")
  const activeFilters = parentView.typeFilters || DEFAULT_TYPE_FILTERS;
  // Filter out "suggestions" to get only relevance/argument types for item matching
  const itemFilters = activeFilters.filter(
    (f): f is Relevance | Argument => f !== "suggestions"
  );
  const visibleItems = relations.items
    .map((item, i) => ({ item, index: i }))
    .filter(({ item }) => itemFilters.some((f) => itemMatchesType(item, f)));

  const childPaths = visibleItems.map(({ index }) =>
    addNodeToPathWithRelations(parentPath, relations, index)
  );
  const nodesInTree = childPaths.reduce(
    (nodesList: List<ViewPath>, childPath: ViewPath) => {
      const childView = getNodeIDFromView(data, childPath)[1];
      if (noExpansion) {
        return nodesList.push(childPath);
      }
      if (childView.expanded) {
        // Recursively get children of expanded node
        // The recursive call will handle adding diff items for childPath at its level
        return getNodesInTree(
          data,
          childPath,
          stack,
          nodesList.push(childPath)
        );
      }
      return nodesList.push(childPath);
    },
    ctx
  );

  // Get diff items based on active type filters from view settings
  const typeFilters = parentView.typeFilters || DEFAULT_TYPE_FILTERS;
  const diffItems = getDiffItemsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID,
    typeFilters,
    relations.id
  );

  const withDiffItems =
    diffItems.size > 0
      ? diffItems.reduce(
          (list, diffItem, idx) =>
            list.push(
              addDiffItemToPath(data, parentPath, diffItem.nodeID, idx, stack)
            ),
          nodesInTree
        )
      : nodesInTree;

  return withDiffItems;
}

function DiffItemIndicator(): JSX.Element {
  return (
    <span
      className="diff-indicator"
      title="Suggestion from other users"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        padding: "1px 6px",
        marginRight: "6px",
        borderRadius: "10px",
        backgroundColor: `${TYPE_COLORS.suggestions}25`,
        color: TYPE_COLORS.suggestions,
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    >
      <span
        className="iconsminds-business-man"
        style={{ fontSize: "0.8rem" }}
      />
      Suggestion
    </span>
  );
}

export function Node({
  className,
  cardBodyClassName,
  isDiffItem,
}: {
  className?: string;
  cardBodyClassName?: string;
  isDiffItem?: boolean;
}): JSX.Element | null {
  const isDesktop = !useMediaQuery(IS_MOBILE);
  const viewPath = useViewPath();
  const levels = getLevels(viewPath);
  const isMultiselect = useIsParentMultiselectBtnOn();
  const isInReferencedByView = useIsInReferencedByView();
  const [, view] = useNodeID();
  const { cardStyle, textStyle } = useItemStyle();
  const defaultCls = isDesktop ? "hover-light-bg" : "";
  const cls =
    className !== undefined ? `${className} hover-light-bg` : defaultCls;
  const clsBody = cardBodyClassName || "ps-0 pt-0 pb-0";

  // Check if this node is the root of a Referenced By view
  const isReferencedByRoot = view.relations === REFERENCED_BY;
  // Show background for both the root and children in Referenced By view
  const showReferencedByBackground = isReferencedByRoot || isInReferencedByView;

  // Show expand/collapse for regular nodes (not diff items, not in Referenced By)
  const showExpandCollapse = !isDiffItem && !isInReferencedByView;

  // Background color for Referenced By view
  const referencedByBgColor = "rgba(100, 140, 180, 0.1)";
  // Background style for content area based on view type
  const getContentBackgroundStyle = (): React.CSSProperties | undefined => {
    if (isDiffItem) {
      // Suggestion items get orange background (no indent coloring needed)
      return { backgroundColor: TYPE_COLORS.suggestions_bg };
    }
    if (showReferencedByBackground) {
      return { backgroundColor: referencedByBgColor };
    }
    return undefined;
  };
  const contentBackgroundStyle = getContentBackgroundStyle();
  // For children in Referenced By, color the last indent level to align with content
  const indentBgColor = isInReferencedByView ? referencedByBgColor : undefined;

  return (
    <NodeCard className={cls} cardBodyClassName={clsBody} style={cardStyle}>
      <LeftMenu />
      {levels > 0 && (
        <Indent levels={levels} backgroundColorForLast={indentBgColor} />
      )}
      {showExpandCollapse && <ExpandCollapseToggle />}
      {isMultiselect && <NodeSelectbox />}
      <div
        className="w-100"
        style={{ paddingTop: 10, ...contentBackgroundStyle }}
      >
        <span style={textStyle}>
          <NodeAutoLink>
            {isDiffItem && <DiffItemIndicator />}
            <InteractiveNodeContent />
          </NodeAutoLink>
        </span>
        <span className="inline-node-actions">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </span>
      </div>
      <RightMenu />
    </NodeCard>
  );
}

export const NOTE_TYPE = "note";
