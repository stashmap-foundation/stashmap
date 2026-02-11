import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNode,
  useViewPath,
  ViewPath,
  useIsInReferencedByView,
  useReferencedByDepth,
  useIsExpanded,
  useIsRoot,
  useRelationIndex,
  useNodeID,
  usePreviousSibling,
  useDisplayText,
  getParentView,
  getRelationForView,
  getRelationIndex,
  getLast,
  getDiffItemsForNode,
  isReferencedByView,
  getContext,
  useIsViewingOtherUserContent,
  useIsSuggestion,
  viewPathToString,
  useEffectiveAuthor,
} from "../ViewContext";
import {
  NodeSelectbox,
  useIsParentMultiselectBtnOn,
  isMutableNode,
} from "./TemporaryViewContext";
import {
  isReferenceNode,
  getRefTargetInfo,
  isEmptyNodeID,
  isAbstractRefId,
  isConcreteRefId,
  parseConcreteRefId,
  getRelationsNoReferencedBy,
  getConcreteRefsForAbstract,
  getRelations,
  isSearchId,
  computeEmptyNodeMetadata,
} from "../connections";
import { DEFAULT_TYPE_FILTERS } from "../constants";
import { IS_MOBILE } from "./responsive";
import { MiniEditor, preventEditorBlur } from "./AddNode";
import { useOnToggleExpanded } from "./SelectRelations";
import { ReferenceIndicators } from "./ReferenceIndicators";
import { useData } from "../DataContext";
import {
  Plan,
  usePlanner,
  planSetEmptyNodePosition,
  planSaveNodeAndEnsureRelations,
  getNextInsertPosition,
  planExpandNode,
  planRemoveEmptyNodePosition,
  planCreateNode,
  planCreateVersion,
  planAddToParent,
  planSetRowFocusIntent,
} from "../planner";
import { planMoveNodeWithView } from "../dnd";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeCard } from "../commons/Ui";
import {
  usePaneStack,
  usePaneIndex,
  useCurrentPane,
  useNavigatePane,
} from "../SplitPanesContext";
import { buildNodeUrl, buildRelationUrl } from "../navigationUrl";
import { RightMenu } from "./RightMenu";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";

export { getNodesInTree } from "../treeTraversal";

function useNodeHasChildren(): boolean {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const [nodeID] = useNodeID();
  const activeFilters = useCurrentPane().typeFilters || DEFAULT_TYPE_FILTERS;

  if (isAbstractRefId(nodeID)) {
    const concreteRefs = getConcreteRefsForAbstract(
      data.knowledgeDBs,
      data.user.publicKey,
      nodeID as LongID
    );
    return Boolean(concreteRefs && concreteRefs.items.size > 0);
  }

  if (isConcreteRefId(nodeID)) {
    const concreteRefChildren = getRelations(
      data.knowledgeDBs,
      nodeID as LongID,
      data.user.publicKey,
      nodeID
    );
    return Boolean(concreteRefChildren && concreteRefChildren.items.size > 0);
  }

  const childRelations = getRelationForView(data, viewPath, stack);
  const hasDirectChildren = Boolean(
    childRelations && childRelations.items.size > 0
  );
  const hasSuggestionChildren =
    getDiffItemsForNode(
      data.knowledgeDBs,
      data.user.publicKey,
      nodeID,
      activeFilters,
      childRelations?.id,
      getContext(data, viewPath, stack)
    ).size > 0;
  return hasDirectChildren || hasSuggestionChildren;
}

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const [nodeID, view] = useNodeID();
  const displayText = useDisplayText();
  const onToggleExpanded = useOnToggleExpanded();
  const isReferencedByRoot = isReferencedByView(view);
  const isInReferencedByView = useIsInReferencedByView();
  const isSearchNode = isSearchId(nodeID as ID);
  const showReferencedByStyle =
    isReferencedByRoot || isInReferencedByView || isSearchNode;

  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptyNodeID(nodeID);

  const onToggle = (): void => {
    if (isEmptyNode) return;
    onToggleExpanded(!isExpanded);
  };

  const toggleClass = [
    "expand-collapse-toggle",
    showReferencedByStyle ? "toggle-referenced-by" : "",
    isEmptyNode ? "toggle-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={preventEditorBlur}
      disabled={isEmptyNode}
      className={toggleClass}
      aria-label={
        isExpanded ? `collapse ${displayText}` : `expand ${displayText}`
      }
      aria-expanded={isExpanded}
    >
      <span className={`triangle ${isExpanded ? "expanded" : "collapsed"}`}>
        {isExpanded ? "▼" : "▶"}
      </span>
    </button>
  );
}

export function LoadingNode(): JSX.Element {
  return <span className="skeleton-bar" />;
}

function ErrorContent(): JSX.Element {
  return <span className="text-danger">Error: Node not found</span>;
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
  const isSuggestion = useIsSuggestion();
  const isReference = nodeType === "reference";
  const isConcreteRef = isConcreteRefId(nodeId);
  const showBrackets = isReference && !isSuggestion;

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

  return (
    <span
      className={`break-word ${showBrackets ? "reference-node" : ""}`}
      data-testid={isReference ? "reference-node" : undefined}
      data-other-user={isOtherUser ? "true" : undefined}
    >
      {showBrackets && <ReferenceIndicators refId={nodeId} />}
      {showBrackets && <span className="reference-bracket">[[</span>}
      <span className={showBrackets ? "reference-text" : ""}>{text}</span>
      {showBrackets && <span className="reference-bracket">]]</span>}
    </span>
  );
}

function EditableContent(): JSX.Element {
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const paneIndex = usePaneIndex();
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const [node] = useNode();
  const [nodeID] = useNodeID();
  const displayText = useDisplayText();
  const prevSibling = usePreviousSibling();
  const parentPath = getParentView(viewPath);
  const viewIsExpanded = useIsExpanded();
  const nodeIsRoot = useIsRoot();
  const relationIndex = useRelationIndex();
  const isEmptyNode = isEmptyNodeID(nodeID);
  const nodeHasChildren = useNodeHasChildren();
  const nodeIsExpanded = viewIsExpanded && nodeHasChildren;

  const emptyNodeMetadata = computeEmptyNodeMetadata(
    data.publishEventsStatus.temporaryEvents
  );
  const parentRelation = parentPath
    ? getRelationForView(data, parentPath, stack)
    : undefined;
  const emptyData = parentRelation
    ? emptyNodeMetadata.get(parentRelation.id)
    : undefined;
  const isRootEmptyNode = isEmptyNode && !parentPath;
  const shouldAutoFocus =
    isEmptyNode && (isRootEmptyNode || emptyData?.paneIndex === paneIndex);
  const escapeFocusPendingRef = React.useRef(false);

  const planWithRowFocusIntent = (
    plan: Plan,
    targetViewPath: ViewPath
  ): Plan => {
    return planSetRowFocusIntent(plan, {
      paneIndex,
      viewKey: viewPathToString(targetViewPath),
      nodeId: getLast(targetViewPath).nodeID,
    });
  };

  const handleSave = (
    text: string,
    _imageUrl?: string,
    submitted?: boolean
  ): void => {
    const { plan: basePlan, viewPath: updatedViewPath } =
      planSaveNodeAndEnsureRelations(createPlan(), text, viewPath, stack);
    const planWithEscFocus = escapeFocusPendingRef.current
      ? planWithRowFocusIntent(basePlan, updatedViewPath)
      : basePlan;
    // eslint-disable-next-line functional/immutable-data
    escapeFocusPendingRef.current = false;

    if (!submitted || !text.trim()) {
      executePlan(planWithEscFocus);
      return;
    }

    const nextPosition = getNextInsertPosition(
      basePlan,
      updatedViewPath,
      nodeIsRoot,
      nodeIsExpanded,
      relationIndex
    );

    if (!nextPosition) {
      executePlan(planWithEscFocus);
      return;
    }

    const [targetPath, newStack, insertIndex] = nextPosition;
    const plan = planSetEmptyNodePosition(
      basePlan,
      targetPath,
      newStack,
      insertIndex
    );
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
    const trimmedText = text.trim();

    // Handle empty nodes: materialize with text, or move empty position if no text
    if (isEmptyNode) {
      if (!parentPath) return;
      const currentParentRelation = getRelationForView(
        basePlan,
        parentPath,
        stack
      );

      // Remove empty node position from old parent
      const planWithoutEmpty = currentParentRelation
        ? planRemoveEmptyNodePosition(basePlan, currentParentRelation.id)
        : basePlan;

      // Expand previous sibling
      const planWithExpand = planExpandNode(
        planWithoutEmpty,
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
          stack
        );
        executePlan(finalPlan);
      } else {
        // No text - just move empty position to previous sibling (at end)
        const finalPlan = planSetEmptyNodePosition(
          planWithExpand,
          prevSibling.viewPath,
          stack,
          0 // Insert at end (will be only child or after existing children)
        );
        executePlan(finalPlan);
      }
      return;
    }

    const prevSiblingContext = getContext(
      basePlan,
      prevSibling.viewPath,
      stack
    );
    const planWithExpand = planExpandNode(
      basePlan,
      prevSibling.view,
      prevSibling.viewPath
    );

    const planWithMove = planMoveNodeWithView(
      planWithExpand,
      viewPath,
      prevSibling.viewPath,
      stack
    );

    const newContext = prevSiblingContext.push(prevSibling.nodeID);
    const originalNodeText = node?.text ?? "";
    const hasTextChanges = trimmedText !== originalNodeText;
    const finalPlan = hasTextChanges
      ? planCreateVersion(planWithMove, nodeID, trimmedText, newContext)
      : planWithMove;

    executePlan(finalPlan);
  };

  const handleShiftTab = (text: string): void => {
    if (!parentPath) {
      return;
    }

    const grandParentPath = getParentView(parentPath);
    if (!grandParentPath) {
      return;
    }

    const basePlan = createPlan();
    const trimmedText = text.trim();
    const parentRelationIndex = getRelationIndex(basePlan, parentPath);

    if (parentRelationIndex === undefined) {
      return;
    }

    if (isEmptyNode) {
      const currentParentRelation = getRelationForView(
        basePlan,
        parentPath,
        stack
      );
      const planWithoutEmpty = currentParentRelation
        ? planRemoveEmptyNodePosition(basePlan, currentParentRelation.id)
        : basePlan;

      if (!trimmedText) {
        executePlan(
          planSetEmptyNodePosition(
            planWithoutEmpty,
            grandParentPath,
            stack,
            parentRelationIndex + 1
          )
        );
        return;
      }

      const [planWithNode, newNode] = planCreateNode(
        planWithoutEmpty,
        trimmedText
      );
      executePlan(
        planAddToParent(
          planWithNode,
          newNode.id,
          grandParentPath,
          stack,
          parentRelationIndex + 1
        )
      );
      return;
    }

    if (!node || node.type !== "text") {
      return;
    }

    const planWithMove = planMoveNodeWithView(
      basePlan,
      viewPath,
      grandParentPath,
      stack,
      parentRelationIndex + 1
    );

    const originalNodeText = node.text ?? "";
    const hasTextChanges = trimmedText !== originalNodeText;

    if (!hasTextChanges) {
      executePlan(planWithMove);
      return;
    }

    const grandParentContext = getContext(basePlan, grandParentPath, stack);
    const grandParentNodeID = getLast(grandParentPath).nodeID;
    const newContext = grandParentContext.push(grandParentNodeID);
    executePlan(
      planCreateVersion(planWithMove, nodeID, trimmedText, newContext)
    );
  };

  const handleRequestRowFocus = ({
    viewKey,
    nodeId,
    rowIndex,
  }: {
    viewKey?: string;
    nodeId?: string;
    rowIndex?: number;
  }): void => {
    const focusTargetNodeId =
      nodeId && !isEmptyNodeID(nodeId as ID) ? nodeId : undefined;
    if (
      viewKey === undefined &&
      focusTargetNodeId === undefined &&
      rowIndex === undefined
    ) {
      return;
    }
    const focusPlan = planSetRowFocusIntent(createPlan(), {
      paneIndex,
      viewKey,
      nodeId: focusTargetNodeId,
      rowIndex,
    });
    executePlan(focusPlan);
  };

  const handleEscapeRequest = (): void => {
    // eslint-disable-next-line functional/immutable-data
    escapeFocusPendingRef.current = true;
  };

  // Handle closing empty node editor (Escape with no text)
  const handleClose = (): void => {
    if (!isEmptyNode || !parentPath) return;
    const plan = createPlan();
    const closeParentRelation = getRelationForView(plan, parentPath, stack);
    if (closeParentRelation) {
      executePlan(planRemoveEmptyNodePosition(plan, closeParentRelation.id));
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
      key={`${viewPathToString(viewPath)}:${relationIndex}`}
      initialText={displayText}
      onSave={handleSave}
      onTab={handleTab}
      onShiftTab={handleShiftTab}
      onClose={isEmptyNode ? handleClose : undefined}
      autoFocus={shouldAutoFocus}
      ariaLabel={isEmptyNode ? "new node editor" : `edit ${displayText}`}
      onEscape={handleEscapeRequest}
      onRequestRowFocus={handleRequestRowFocus}
    />
  );
}

function InteractiveNodeContent(): JSX.Element {
  const [node] = useNode();
  const [nodeID, view] = useNodeID();
  const displayText = useDisplayText();
  const isLoading = useNodeIsLoading();
  const isInReferencedByView = useIsInReferencedByView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isSuggestionNode = useIsSuggestion();
  const isReferencedByRoot = isReferencedByView(view);
  const isEmptyNode = isEmptyNodeID(nodeID);

  const isReadonly =
    isInReferencedByView ||
    isReferencedByRoot ||
    isViewingOtherUserContent ||
    isSuggestionNode;

  if (isLoading) {
    return <LoadingNode />;
  }

  // For empty placeholder nodes, render EditableContent only if not readonly
  if (isEmptyNode) {
    return isReadonly ? <></> : <EditableContent />;
  }

  if (!node) {
    return <ErrorContent />;
  }

  // Editable content for mutable nodes (but read-only when viewing others' content)
  if (isMutableNode(node) && !isReadonly) {
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
  const { knowledgeDBs, user } = useData();
  const [node] = useNode();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();

  if (node && isReferenceNode(node)) {
    const refInfo = getRefTargetInfo(node.id, knowledgeDBs, effectiveAuthor);
    if (refInfo) {
      const href = refInfo.rootRelation
        ? buildRelationUrl(refInfo.rootRelation)
        : buildNodeUrl(
            refInfo.stack,
            knowledgeDBs,
            user.publicKey,
            refInfo.author
          ) || "#";
      return (
        <a
          href={href}
          className="reference-link-btn"
          onClick={(e) => {
            e.preventDefault();
            navigatePane(href);
          }}
          aria-label={`Navigate to ${displayText}`}
        >
          {children}
        </a>
      );
    }
  }

  return <>{children}</>;
}

export const INDENTATION = 25;
const ARROW_WIDTH = 0;

export function Indent({
  levels,
  colorLevels,
}: {
  levels: number;
  colorLevels?: number;
}): JSX.Element {
  return (
    <>
      {Array.from(Array(levels).keys()).map((k) => {
        const marginLeft = k === 0 ? 5 : ARROW_WIDTH;
        const width = k === 0 ? 0 : INDENTATION;
        const levelsFromRight = levels - k;
        const showBorder =
          colorLevels !== undefined && levelsFromRight === colorLevels;

        return (
          <div
            key={k}
            className={`indent-spacer${showBorder ? " indent-border" : ""}`}
            style={{
              marginLeft,
              minWidth: width,
            }}
          />
        );
      })}
    </>
  );
}

function SuggestionIndicator(): JSX.Element {
  return (
    <span
      className="suggestion-indicator"
      title="Suggestion from other users"
      aria-hidden="true"
    >
      @
    </span>
  );
}

export function Node({
  className,
  cardBodyClassName,
  isSuggestion,
}: {
  className?: string;
  cardBodyClassName?: string;
  isSuggestion?: boolean;
}): JSX.Element | null {
  const isDesktop = !useMediaQuery(IS_MOBILE);
  const viewPath = useViewPath();
  const levels = getLevels(viewPath);
  const isMultiselect = useIsParentMultiselectBtnOn();
  const referencedByDepth = useReferencedByDepth();
  const isInReferencedByView = referencedByDepth !== undefined;
  const [, view] = useNodeID();
  const { cardStyle, textStyle, relevance } = useItemStyle();
  const defaultCls = isDesktop ? "hover-light-bg" : "";
  const cls =
    className !== undefined ? `${className} hover-light-bg` : defaultCls;
  const clsBody = cardBodyClassName || "ps-0";

  const [nodeID] = useNodeID();

  // Check if this node is the root of a Referenced By view
  const isReferencedByRoot = isReferencedByView(view);
  // Check if this is a search node
  const isSearchNode = isSearchId(nodeID as ID);
  // Show background for Referenced By views and search results
  const showReferencedByBackground =
    isReferencedByRoot || isInReferencedByView || isSearchNode;

  // Abstract refs can be expanded to show concrete refs
  const isAbstractRef = isAbstractRefId(nodeID);
  // Concrete refs are terminal - no children, no toggle
  const isConcreteRef = isConcreteRefId(nodeID);
  // Check if this is any kind of reference node
  const isReference = isAbstractRef || isConcreteRef;

  // Show expand/collapse for:
  // - Regular nodes (not in Referenced By view)
  // - Abstract refs (to show concrete refs)
  // - Suggestions that are concrete refs (to show source author's children)
  const isSuggestionWithChildren = isSuggestion && isConcreteRef;
  const showExpandCollapse =
    (!isSuggestion && !isConcreteRef && !isInReferencedByView) ||
    isAbstractRef ||
    isSuggestionWithChildren;
  const hasChildren = useNodeHasChildren();

  // Content class for styling based on view mode
  const getContentClass = (): string => {
    if (isSuggestion) {
      return "content-suggestion";
    }
    if (showReferencedByBackground) {
      return "content-referenced-by";
    }
    return "";
  };
  const contentClass = getContentClass();

  return (
    <EditorTextProvider>
      <NodeCard
        className={cls}
        cardBodyClassName={clsBody}
        style={cardStyle}
        data-suggestion={isSuggestion ? "true" : undefined}
      >
        <div className="indicator-gutter">
          {isSuggestion && <SuggestionIndicator />}
          {relevance === "relevant" && !isSuggestion && (
            <span
              className="relevant-indicator"
              title="Relevant"
              aria-hidden="true"
            >
              !
            </span>
          )}
          {relevance === "maybe_relevant" && !isSuggestion && (
            <span
              className="maybe-relevant-indicator"
              title="Maybe Relevant"
              aria-hidden="true"
            >
              ?
            </span>
          )}
          {relevance === "little_relevant" && !isSuggestion && (
            <span
              className="little-relevant-indicator"
              title="Little Relevant"
              aria-hidden="true"
            >
              ~
            </span>
          )}
          {(showReferencedByBackground || isReference) && !isSuggestion && (
            <span className="reference-indicator" aria-label="reference">
              ⤶
            </span>
          )}
        </div>
        {levels > 0 && (
          <Indent levels={levels} colorLevels={referencedByDepth} />
        )}
        {showExpandCollapse && hasChildren && <ExpandCollapseToggle />}
        {((showExpandCollapse && !hasChildren) ||
          (isConcreteRef && !showExpandCollapse) ||
          (isSuggestion && !showExpandCollapse)) && (
          <span
            className="node-marker"
            aria-hidden="true"
            data-testid="node-marker"
          />
        )}
        {isMultiselect && <NodeSelectbox />}
        <div className={`w-100 node-content-wrapper ${contentClass}`}>
          <span style={textStyle}>
            <NodeAutoLink>
              <InteractiveNodeContent />
            </NodeAutoLink>
          </span>
          {!isEmptyNodeID(nodeID) && (
            <span className="inline-node-actions">
              <FullscreenButton />
              <OpenInSplitPaneButton />
            </span>
          )}
        </div>
        <RightMenu />
      </NodeCard>
    </EditorTextProvider>
  );
}

export const NOTE_TYPE = "note";
