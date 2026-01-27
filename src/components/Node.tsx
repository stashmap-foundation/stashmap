import { List } from "immutable";
import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNode,
  useViewPath,
  ViewPath,
  useIsInReferencedByView,
  useIsExpanded,
  addNodeToPathWithRelations,
  addDiffItemToPath,
  getDiffItemsForNode,
  getNodeIDFromView,
  useNodeID,
  getContextFromStackAndViewPath,
  getRelationsForContext,
  usePreviousSibling,
  useDisplayText,
  getParentView,
  useNextInsertPosition,
  isRoot,
} from "../ViewContext";
import {
  NodeSelectbox,
  useIsParentMultiselectBtnOn,
  isMutableNode,
} from "./TemporaryViewContext";
import {
  getReferencedByRelations,
  getConcreteRefsForAbstract,
  isReferenceNode,
  getRefTargetInfo,
  itemMatchesType,
  isEmptyNodeID,
  isAbstractRefId,
  isConcreteRefId,
  parseConcreteRefId,
  getRelationsNoReferencedBy,
} from "../connections";
import { REFERENCED_BY, DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";
import { IS_MOBILE } from "./responsive";
import { MiniEditor, preventEditorBlurIfSameNode } from "./AddNode";
import { useOnToggleExpanded } from "./SelectRelations";
import { ReferenceIndicators } from "./ReferenceIndicators";
import { useData } from "../DataContext";
import {
  usePlanner,
  planSetEmptyNodePosition,
  planSaveNodeAndEnsureRelations,
  planExpandNode,
  planRemoveEmptyNodePosition,
  planCreateNode,
  planCreateVersion,
  planAddToParent,
  planDeepCopyNodeWithView,
} from "../planner";
import { planDisconnectFromParent } from "../dnd";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeIcon } from "./NodeIcon";
import { NodeCard } from "../commons/Ui";
import {
  usePaneStack,
  useSplitPanes,
  useCurrentPane,
  usePaneAuthor,
} from "../SplitPanesContext";
import { LeftMenu } from "./LeftMenu";
import { RightMenu } from "./RightMenu";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const [nodeID, view] = useNodeID();
  const displayText = useDisplayText();
  const onToggleExpanded = useOnToggleExpanded();
  const isReferencedBy = view.relations === REFERENCED_BY;

  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptyNodeID(nodeID);

  const baseColor = isReferencedBy ? TYPE_COLORS.referenced_by : "black";
  const color = isEmptyNode ? "#ccc" : baseColor;

  const onToggle = (): void => {
    if (isEmptyNode) return;
    onToggleExpanded(!isExpanded);
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={preventEditorBlurIfSameNode}
      disabled={isEmptyNode}
      className="expand-collapse-toggle"
      aria-label={
        isExpanded ? `collapse ${displayText}` : `expand ${displayText}`
      }
      aria-expanded={isExpanded}
      style={{
        color,
        backgroundColor: isReferencedBy
          ? "rgba(100, 140, 180, 0.1)"
          : undefined,
        cursor: isEmptyNode ? "default" : "pointer",
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

function NodeContent({
  nodeType,
  nodeId,
  text,
}: {
  nodeType: KnowNode["type"];
  nodeId: LongID | ID;
  text: string;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const isReference = nodeType === "reference";
  const isConcreteRef = isConcreteRefId(nodeId);

  const isOtherUser = (() => {
    if (!isConcreteRef) return false;
    const parsed = parseConcreteRefId(nodeId);
    if (!parsed) return false;
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      parsed.relationID,
      user.publicKey
    );
    return relation ? relation.author !== user.publicKey : false;
  })();

  const referenceStyle: React.CSSProperties = isReference
    ? {
        fontStyle: "italic",
        color: "#5a7bad",
        textDecoration: "none",
        borderBottom: "1px dotted #8fadd4",
      }
    : {};

  return (
    <span
      className={`break-word ${isReference ? "reference-node" : ""}`}
      data-testid={isReference ? "reference-node" : undefined}
      data-other-user={isOtherUser ? "true" : undefined}
    >
      <NodeIcon nodeType={nodeType} />
      {isReference && <ReferenceIndicators refId={nodeId} />}
      <span style={referenceStyle}>{text}</span>
    </span>
  );
}

function EditableContent(): JSX.Element {
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const paneAuthor = usePaneAuthor();
  const { createPlan, executePlan } = usePlanner();
  const [node] = useNode();
  const [nodeID] = useNodeID();
  const displayText = useDisplayText();
  const prevSibling = usePreviousSibling();
  const parentPath = getParentView(viewPath);
  const nextInsertPosition = useNextInsertPosition();
  const isEmptyNode = isEmptyNodeID(nodeID);

  const handleSave = (
    text: string,
    _imageUrl?: string,
    submitted?: boolean
  ): void => {
    const basePlan = planSaveNodeAndEnsureRelations(
      createPlan(),
      text,
      viewPath,
      stack,
      paneAuthor
    );

    const plan =
      submitted && nextInsertPosition
        ? planSetEmptyNodePosition(
            basePlan,
            nextInsertPosition[0],
            stack,
            nextInsertPosition[1],
            paneAuthor
          )
        : basePlan;

    executePlan(plan);
  };

  const handleTab = (text: string): void => {
    if (!prevSibling) {
      return;
    }

    // For regular nodes, check node type
    if (!isEmptyNode && (!node || node.type !== "text")) {
      return;
    }

    const basePlan = createPlan();
    const context = getContextFromStackAndViewPath(stack, viewPath);
    const trimmedText = text.trim();

    // Handle empty nodes: materialize with text, or move empty position if no text
    if (isEmptyNode) {
      if (!parentPath) return;
      const [, parentView] = getNodeIDFromView(basePlan, parentPath);
      const relationsID = parentView.relations;

      // Remove empty node position from old parent
      const planWithoutEmpty = relationsID
        ? planRemoveEmptyNodePosition(basePlan, relationsID)
        : basePlan;

      // Expand previous sibling
      const prevSiblingContext = getContextFromStackAndViewPath(
        stack,
        prevSibling.viewPath
      );
      const planWithExpand = planExpandNode(
        planWithoutEmpty,
        prevSibling.nodeID,
        prevSiblingContext,
        prevSibling.view,
        prevSibling.viewPath
      );

      if (trimmedText) {
        // Has text - create real node and add to previous sibling
        const [planWithNode, newNode] = planCreateNode(
          planWithExpand,
          trimmedText
        );
        const finalPlan = planAddToParent(
          planWithNode,
          newNode.id,
          prevSibling.viewPath,
          stack,
          paneAuthor
        );
        executePlan(finalPlan);
      } else {
        // No text - just move empty position to previous sibling (at end)
        const finalPlan = planSetEmptyNodePosition(
          planWithExpand,
          prevSibling.viewPath,
          stack,
          0, // Insert at end (will be only child or after existing children)
          paneAuthor
        );
        executePlan(finalPlan);
      }
      return;
    }

    // Handle regular nodes
    // Step 1: Expand the previous sibling (ensure it has relations)
    const prevSiblingContext = getContextFromStackAndViewPath(
      stack,
      prevSibling.viewPath
    );
    const planWithExpand = planExpandNode(
      basePlan,
      prevSibling.nodeID,
      prevSiblingContext,
      prevSibling.view,
      prevSibling.viewPath
    );

    // Step 2: Deep copy node to previous sibling (copies node + all descendants + views)
    // Must happen BEFORE disconnect so views are still available to copy
    const planWithDeepCopy = planDeepCopyNodeWithView(
      planWithExpand,
      nodeID,
      context,
      viewPath,
      prevSibling.viewPath,
      stack
    );

    // Step 3: Disconnect current node from current parent
    const planWithDisconnect = planDisconnectFromParent(
      planWithDeepCopy,
      viewPath,
      stack,
      paneAuthor
    );

    // Step 4: Save text changes in NEW context (if any)
    // The node's new context is prevSiblingContext + prevSibling's ID
    const newContext = prevSiblingContext.push(prevSibling.nodeID);
    const originalNodeText = node?.text ?? "";
    const hasTextChanges = trimmedText !== originalNodeText;
    const finalPlan = hasTextChanges
      ? planCreateVersion(planWithDisconnect, nodeID, trimmedText, newContext)
      : planWithDisconnect;

    executePlan(finalPlan);
  };

  // Handle closing empty node editor (Escape with no text)
  const handleClose = (): void => {
    if (!isEmptyNode || !parentPath) return;
    const plan = createPlan();
    const [, parentView] = getNodeIDFromView(plan, parentPath);
    const relationsID = parentView.relations;
    if (relationsID) {
      executePlan(planRemoveEmptyNodePosition(plan, relationsID));
    }
  };

  // For non-text nodes (and non-empty nodes), show read-only content
  if (!isEmptyNode && (!node || node.type !== "text")) {
    return (
      <NodeContent nodeType={node!.type} nodeId={nodeID} text={displayText} />
    );
  }

  return (
    <MiniEditor
      initialText={displayText}
      onSave={handleSave}
      onTab={handleTab}
      onClose={isEmptyNode ? handleClose : undefined}
      autoFocus={isEmptyNode}
      ariaLabel={isEmptyNode ? "new node editor" : `edit ${displayText}`}
    />
  );
}

function InteractiveNodeContent(): JSX.Element {
  const [node] = useNode();
  const [nodeID, view] = useNodeID();
  const displayText = useDisplayText();
  const isLoading = useNodeIsLoading();
  const isInReferencedByView = useIsInReferencedByView();
  // Also check if this is the root node of a Referenced By view
  const isReferencedByRoot = view.relations === REFERENCED_BY;
  const isEmptyNode = isEmptyNodeID(nodeID);

  if (isLoading) {
    return <LoadingNode />;
  }

  // For empty placeholder nodes, always render EditableContent
  if (isEmptyNode) {
    return <EditableContent />;
  }

  if (!node) {
    return <ErrorContent />;
  }

  // Editable content for mutable nodes (but read-only in Referenced By view)
  if (isMutableNode(node) && !isInReferencedByView && !isReferencedByRoot) {
    return <EditableContent />;
  }

  // Read-only content
  return (
    <NodeContent nodeType={node.type} nodeId={nodeID} text={displayText} />
  );
}

function NodeAutoLink({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { knowledgeDBs, user } = useData();
  const [node] = useNode();
  const displayText = useDisplayText();

  if (node && isReferenceNode(node)) {
    const refInfo = getRefTargetInfo(node.id, knowledgeDBs, user.publicKey);
    if (refInfo) {
      const handleClick = (): void => {
        setPane({
          ...pane,
          stack: refInfo.stack,
          author: refInfo.author,
          rootRelation: refInfo.rootRelation,
        });
      };
      return (
        <button
          type="button"
          className="reference-link-btn"
          onClick={handleClick}
          aria-label={`Navigate to ${displayText}`}
        >
          {children}
        </button>
      );
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
  paneAuthor: PublicKey,
  rootRelation: LongID | undefined,
  noExpansion?: boolean
): List<ViewPath> {
  const [parentNodeID, parentView] = getNodeIDFromView(data, parentPath);

  // Handle abstract refs - their children are concrete refs, can be expanded
  if (isAbstractRefId(parentNodeID)) {
    const relations = getConcreteRefsForAbstract(
      data.knowledgeDBs,
      data.user.publicKey,
      parentNodeID as LongID
    );
    if (!relations || relations.items.size === 0) {
      return ctx;
    }
    const childPaths = relations.items.map((_, i) =>
      addNodeToPathWithRelations(parentPath, relations, i)
    );
    return ctx.concat(childPaths);
  }

  // Handle concrete refs - terminal nodes, no children
  if (isConcreteRefId(parentNodeID)) {
    return ctx;
  }

  // Handle REFERENCED_BY view - shows abstract/concrete refs
  if (parentView.relations === REFERENCED_BY) {
    const relations = getReferencedByRelations(
      data.knowledgeDBs,
      data.user.publicKey,
      parentNodeID
    );
    if (!relations || relations.items.size === 0) {
      return ctx;
    }
    // Check if children are expanded and recurse
    return relations.items.reduce((nodesList, _, i) => {
      const childPath = addNodeToPathWithRelations(parentPath, relations, i);
      const [childNodeID, childView] = getNodeIDFromView(data, childPath);
      if (childView.expanded && isAbstractRefId(childNodeID)) {
        return getNodesInTree(
          data,
          childPath,
          stack,
          nodesList.push(childPath),
          paneAuthor,
          rootRelation
        );
      }
      return nodesList.push(childPath);
    }, ctx);
  }
  const context = getContextFromStackAndViewPath(stack, parentPath);
  const relations = getRelationsForContext(
    data.knowledgeDBs,
    paneAuthor,
    parentNodeID,
    context,
    rootRelation,
    isRoot(parentPath)
  );

  // Filter items based on view's typeFilters (default filters out "not_relevant")
  const activeFilters = parentView.typeFilters || DEFAULT_TYPE_FILTERS;
  // Filter out "suggestions" to get only relevance/argument types for item matching
  const itemFilters = activeFilters.filter(
    (f): f is Relevance | Argument => f !== "suggestions"
  );

  const nodesInTree = relations
    ? relations.items
        .map((item, i) => ({ item, index: i }))
        .filter(({ item }) => itemFilters.some((f) => itemMatchesType(item, f)))
        .map(({ index }) => addNodeToPathWithRelations(parentPath, relations, index))
        .reduce((nodesList: List<ViewPath>, childPath: ViewPath) => {
          const childView = getNodeIDFromView(data, childPath)[1];
          if (noExpansion) {
            return nodesList.push(childPath);
          }
          if (childView.expanded) {
            return getNodesInTree(
              data,
              childPath,
              stack,
              nodesList.push(childPath),
              paneAuthor,
              rootRelation
            );
          }
          return nodesList.push(childPath);
        }, ctx)
    : ctx;

  // Get diff items based on active type filters from view settings
  const typeFilters = parentView.typeFilters || DEFAULT_TYPE_FILTERS;
  const diffItems = getDiffItemsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID,
    typeFilters,
    relations?.id
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

  const [nodeID] = useNodeID();

  // Check if this node is the root of a Referenced By view
  const isReferencedByRoot = view.relations === REFERENCED_BY;
  // Show background for both the root and children in Referenced By view
  const showReferencedByBackground = isReferencedByRoot || isInReferencedByView;

  // Abstract refs can be expanded to show concrete refs
  const isAbstractRef = isAbstractRefId(nodeID);
  // Concrete refs are terminal - no children, no toggle
  const isConcreteRef = isConcreteRefId(nodeID);

  // Show expand/collapse for regular nodes (not diff items, not in Referenced By, not empty nodes)
  // Also show for abstract refs which need expand to show concrete refs
  // Never show for concrete refs - they are terminal nodes
  const showExpandCollapse = !isDiffItem && !isConcreteRef && (!isInReferencedByView || isAbstractRef);

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
    <EditorTextProvider>
      <NodeCard
        className={cls}
        cardBodyClassName={clsBody}
        style={cardStyle}
        data-suggestion={isDiffItem ? "true" : undefined}
      >
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
    </EditorTextProvider>
  );
}

export const NOTE_TYPE = "note";
