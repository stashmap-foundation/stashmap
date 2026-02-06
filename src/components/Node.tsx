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
  isReferencedByView,
  getContext,
  useIsViewingOtherUserContent,
  useIsSuggestion,
  viewPathToString,
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
  isSearchId,
  computeEmptyNodeMetadata,
} from "../connections";
import { IS_MOBILE } from "./responsive";
import { MiniEditor, preventEditorBlurIfSameNode } from "./AddNode";
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
  planDeepCopyNodeWithView,
  planSetRowFocusIntent,
} from "../planner";
import { planDisconnectFromParent } from "../dnd";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeCard } from "../commons/Ui";
import {
  usePaneStack,
  usePaneIndex,
  useSplitPanes,
  useCurrentPane,
} from "../SplitPanesContext";
import { RightMenu } from "./RightMenu";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";

export { getNodesInTree } from "../treeTraversal";

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
      onMouseDown={preventEditorBlurIfSameNode}
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
  const nodeIsExpanded = useIsExpanded();
  const nodeIsRoot = useIsRoot();
  const relationIndex = useRelationIndex();
  const isEmptyNode = isEmptyNodeID(nodeID);

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
    submitted?: boolean,
    reason?: "enter" | "escape" | "blur"
  ): void => {
    const { plan: basePlan, viewPath: updatedViewPath } =
      planSaveNodeAndEnsureRelations(createPlan(), text, viewPath, stack);
    const planWithEscFocus =
      reason === "escape"
        ? planWithRowFocusIntent(basePlan, updatedViewPath)
        : basePlan;

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
    const context = getContext(basePlan, viewPath, stack);
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

    // Handle regular nodes
    // Step 1: Expand the previous sibling
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
      stack
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

      const [planWithNode, newNode] = planCreateNode(planWithoutEmpty, trimmedText);
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

    const context = getContext(basePlan, viewPath, stack);
    const planWithCopy = planDeepCopyNodeWithView(
      basePlan,
      nodeID,
      context,
      viewPath,
      grandParentPath,
      stack,
      parentRelationIndex + 1
    );
    const planWithDisconnect = planDisconnectFromParent(
      planWithCopy,
      viewPath,
      stack
    );

    const originalNodeText = node.text ?? "";
    const hasTextChanges = trimmedText !== originalNodeText;

    if (!hasTextChanges) {
      executePlan(planWithDisconnect);
      return;
    }

    const grandParentContext = getContext(basePlan, grandParentPath, stack);
    const grandParentNodeID = getLast(grandParentPath).nodeID;
    const newContext = grandParentContext.push(grandParentNodeID);
    executePlan(planCreateVersion(planWithDisconnect, nodeID, trimmedText, newContext));
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
  const clsBody = cardBodyClassName || "ps-0 pt-0 pb-0";

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
        {showExpandCollapse && <ExpandCollapseToggle />}
        {isConcreteRef && !showExpandCollapse && (
          <button
            type="button"
            disabled
            className="expand-collapse-toggle toggle-hidden"
            aria-label="concrete reference"
            aria-hidden="true"
          >
            <span className="triangle collapsed">▶</span>
          </button>
        )}
        {isMultiselect && <NodeSelectbox />}
        <div className={`w-100 node-content-wrapper ${contentClass}`}>
          <span style={textStyle}>
            <NodeAutoLink>
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
