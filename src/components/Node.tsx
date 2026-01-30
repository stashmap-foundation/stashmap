import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNode,
  useViewPath,
  ViewPath,
  useIsInReferencedByView,
  useReferencedByDepth,
  useIsExpanded,
  useNodeID,
  usePreviousSibling,
  useDisplayText,
  getParentView,
  useNextInsertPosition,
  getRelationForView,
  isReferencedByView,
  getContextFromStackAndViewPath,
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
  getConcreteRefs,
  computeEmptyNodeMetadata,
} from "../connections";
import { TYPE_COLORS } from "../constants";
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
  usePaneIndex,
  useSplitPanes,
  useCurrentPane,
  useIsViewingOtherUserContent,
} from "../SplitPanesContext";
import { ReferenceCount } from "./ReferenceCount";
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
  const showReferencedByStyle = isReferencedByRoot || isInReferencedByView || isSearchNode;

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
  ].filter(Boolean).join(" ");

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

  return (
    <span
      className={`break-word ${isReference ? "reference-node" : ""}`}
      data-testid={isReference ? "reference-node" : undefined}
      data-other-user={isOtherUser ? "true" : undefined}
    >
      <NodeIcon nodeType={nodeType} />
      {isReference && <ReferenceIndicators refId={nodeId} />}
      {text}
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
  const nextInsertPosition = useNextInsertPosition();
  const isEmptyNode = isEmptyNodeID(nodeID);

  const emptyNodeMetadata = computeEmptyNodeMetadata(data.publishEventsStatus.temporaryEvents);
  const parentRelation = parentPath ? getRelationForView(data, parentPath, stack) : undefined;
  const emptyData = parentRelation ? emptyNodeMetadata.get(parentRelation.id) : undefined;
  const shouldAutoFocus = isEmptyNode && emptyData?.paneIndex === paneIndex;

  const handleSave = (
    text: string,
    _imageUrl?: string,
    submitted?: boolean
  ): void => {
    const basePlan = planSaveNodeAndEnsureRelations(
      createPlan(),
      text,
      viewPath,
      stack
    );

    const plan =
      submitted && nextInsertPosition
        ? planSetEmptyNodePosition(
          basePlan,
          nextInsertPosition[0],
          stack,
          nextInsertPosition[1]
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
      const parentRelation = getRelationForView(basePlan, parentPath, stack);

      // Remove empty node position from old parent
      const planWithoutEmpty = parentRelation
        ? planRemoveEmptyNodePosition(basePlan, parentRelation.id)
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
    const prevSiblingContext = getContextFromStackAndViewPath(
      stack,
      prevSibling.viewPath
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

  // Handle closing empty node editor (Escape with no text)
  const handleClose = (): void => {
    if (!isEmptyNode || !parentPath) return;
    const plan = createPlan();
    const parentRelation = getRelationForView(plan, parentPath, stack);
    if (parentRelation) {
      executePlan(planRemoveEmptyNodePosition(plan, parentRelation.id));
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
      autoFocus={shouldAutoFocus}
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
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  // Also check if this is the root node of a Referenced By view
  const isReferencedByRoot = isReferencedByView(view);
  const isEmptyNode = isEmptyNodeID(nodeID);

  const isReadonly =
    isInReferencedByView || isReferencedByRoot || isViewingOtherUserContent;

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

function DiffItemIndicator(): JSX.Element {
  return (
    <span
      className="diff-indicator"
      title="Suggestion from other users"
      aria-hidden="true"
    >
      ●
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
  const referencedByDepth = useReferencedByDepth();
  const isInReferencedByView = referencedByDepth !== undefined;
  const [, view] = useNodeID();
  const { cardStyle, textStyle } = useItemStyle();
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
  const showReferencedByBackground = isReferencedByRoot || isInReferencedByView || isSearchNode;

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
  const isSuggestionWithChildren = isDiffItem && isConcreteRef;
  const showExpandCollapse =
    (!isDiffItem && !isConcreteRef && !isInReferencedByView) ||
    isAbstractRef ||
    isSuggestionWithChildren;

  // Content class for styling based on view mode
  const getContentClass = (): string => {
    if (isDiffItem) {
      return "content-diff-item";
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
        data-suggestion={isDiffItem ? "true" : undefined}
      >
        <div className="indicator-gutter">
          {isDiffItem && <DiffItemIndicator />}
          {(showReferencedByBackground || isReference) && !isDiffItem && (
            <span className="reference-indicator" aria-label="reference">⤶</span>
          )}
        </div>
        {levels > 0 && (
          <Indent
            levels={levels}
            colorLevels={referencedByDepth}
          />
        )}
        {showExpandCollapse && <ExpandCollapseToggle />}
        {isConcreteRef && (
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
