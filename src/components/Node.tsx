import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNode,
  useViewPath,
  ViewPath,
  useSearchDepth,
  useIsInSearchView,
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
  getContext,
  getNodeIDFromView,
  useIsViewingOtherUserContent,
  useRelationItem,
  viewPathToString,
  useEffectiveAuthor,
} from "../ViewContext";
import { isMutableNode } from "./TemporaryViewContext";
import { planBatchIndent, planBatchOutdent } from "./batchOperations";
import {
  isReferenceNode,
  getRefTargetInfo,
  isEmptyNodeID,
  isConcreteRefId,
  computeEmptyNodeMetadata,
  shortID,
} from "../connections";
import { TYPE_COLORS } from "../constants";
import { IS_MOBILE } from "./responsive";
import { MiniEditor, preventEditorBlur } from "./AddNode";
import { useOnToggleExpanded } from "./SelectRelations";
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
  planAddToParent,
  planSetRowFocusIntent,
  ParsedLine,
} from "../planner";
import {
  parsedLinesToTrees,
  planCreateNodesFromMarkdownTrees,
} from "./FileDropZone";
import { planDisconnectFromParent } from "../dnd";
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
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";
import { getChildNodes } from "../treeTraversal";

export { getNodesInTree } from "../treeTraversal";

function useNodeHasChildren(): boolean {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const result = getChildNodes(data, viewPath, stack, pane.rootRelation);
  return result.paths.size > 0;
}

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const [nodeID] = useNodeID();
  const displayText = useDisplayText();
  const onToggleExpanded = useOnToggleExpanded();
  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptyNodeID(nodeID);
  const onToggle = (): void => {
    if (isEmptyNode) return;
    onToggleExpanded(!isExpanded);
  };

  const toggleClass = [
    "expand-collapse-toggle",
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

function relevanceColor(relevance: Relevance): string | undefined {
  if (relevance === "relevant") return TYPE_COLORS.relevant;
  if (relevance === "maybe_relevant") return TYPE_COLORS.maybe_relevant;
  if (relevance === "little_relevant") return TYPE_COLORS.little_relevant;
  return undefined;
}

function relevanceChar(relevance: Relevance): string {
  if (relevance === "relevant") return "!";
  if (relevance === "maybe_relevant") return "?";
  if (relevance === "little_relevant") return "~";
  return "";
}

function argumentChar(argument: Argument | undefined): string {
  if (argument === "confirms") return "+";
  if (argument === "contra") return "-";
  return "";
}

function argumentColor(argument: Argument | undefined): string | undefined {
  if (argument === "confirms") return TYPE_COLORS.confirms;
  if (argument === "contra") return TYPE_COLORS.contra;
  return undefined;
}

function IncomingIndicator({
  relevance,
  argument,
}: {
  relevance?: Relevance;
  argument?: Argument;
}): JSX.Element | null {
  const relChar = relevanceChar(relevance);
  const argChar = argumentChar(argument);
  if (!relChar && !argChar) {
    return null;
  }
  return (
    <>
      {relChar && (
        <span style={{ color: relevanceColor(relevance) }}>{relChar}</span>
      )}
      {argChar && (
        <span style={{ color: argumentColor(argument) }}>{argChar}</span>
      )}
    </>
  );
}

function VersionContent({ node }: { node: ReferenceNode }): JSX.Element {
  const { user } = useData();
  const meta = node.versionMeta;
  const isOtherUser = node.author !== user.publicKey;
  const dateStr = meta ? new Date(meta.updated).toLocaleString() : "";
  return (
    <span className="break-word" data-testid="reference-node">
      {dateStr}
      <span style={{ fontStyle: "normal" }}>
        {isOtherUser && " \u{1F464}"}
        {meta && meta.addCount > 0 && (
          <>
            {" "}
            <span style={{ color: "var(--green)" }}>+{meta.addCount}</span>
          </>
        )}
        {meta && meta.removeCount > 0 && (
          <>
            {" "}
            <span style={{ color: "var(--red)" }}>-{meta.removeCount}</span>
          </>
        )}
      </span>
    </span>
  );
}

function OtherUserIcon({ node }: { node: ReferenceNode }): JSX.Element | null {
  const { user } = useData();
  if (node.author === user.publicKey) {
    return null;
  }
  return <span style={{ fontStyle: "normal" }}>{" \u{1F464}"}</span>;
}

function ReferenceContent({ node }: { node: ReferenceNode }): JSX.Element {
  const virtualType = useRelationItem()?.virtualType;

  if (node.deleted) {
    const contextPath = node.contextLabels.join(" / ");
    return (
      <span
        className="break-word deleted-reference"
        data-testid="reference-node"
      >
        (deleted){" "}
        {contextPath && (
          <>
            {contextPath} <span className="ref-separator">&gt;&gt;&gt;</span>{" "}
          </>
        )}
        {node.targetLabel}
      </span>
    );
  }

  if (virtualType === "version" || node.versionMeta) {
    return <VersionContent node={node} />;
  }

  if (virtualType === "suggestion") {
    return (
      <span className="break-word" data-testid="reference-node">
        {node.targetLabel}
      </span>
    );
  }

  if (virtualType === "incoming") {
    const reversed = [...node.contextLabels].reverse().join(" / ");
    return (
      <span className="break-word" data-testid="reference-node">
        {node.targetLabel}{" "}
        <IncomingIndicator
          relevance={node.incomingRelevance}
          argument={node.incomingArgument}
        />
        {reversed && (
          <>
            {" "}
            <span className="ref-separator">&lt;&lt;&lt;</span> {reversed}
          </>
        )}
        <OtherUserIcon node={node} />
      </span>
    );
  }

  const contextPath = node.contextLabels.join(" / ");
  return (
    <span className="break-word" data-testid="reference-node">
      {contextPath && (
        <>
          {contextPath}{" "}
          {node.isBidirectional && (
            <>
              <span className="ref-separator">&lt;&lt;&lt;</span>{" "}
            </>
          )}
          <span className="ref-separator">&gt;&gt;&gt;</span>
          {node.incomingRelevance || node.incomingArgument ? (
            <>
              {" "}
              <IncomingIndicator
                relevance={node.incomingRelevance}
                argument={node.incomingArgument}
              />
            </>
          ) : null}{" "}
        </>
      )}
      {node.targetLabel}
      <OtherUserIcon node={node} />
    </span>
  );
}

function NodeContent(): JSX.Element {
  const [node] = useNode();
  const displayText = useDisplayText();

  if (node && node.type === "reference") {
    return <ReferenceContent node={node} />;
  }

  return <span className="break-word">{displayText}</span>;
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
    if (!isEmptyNode && (!node || node.type !== "text")) {
      return;
    }

    const basePlan = createPlan();
    const trimmedText = text.trim();

    if (isEmptyNode) {
      if (!prevSibling || !parentPath) return;
      const currentParentRelation = getRelationForView(
        basePlan,
        parentPath,
        stack
      );
      const planWithoutEmpty = currentParentRelation
        ? planRemoveEmptyNodePosition(basePlan, currentParentRelation.id)
        : basePlan;
      const planWithExpand = planExpandNode(
        planWithoutEmpty,
        prevSibling.view,
        prevSibling.viewPath
      );

      if (trimmedText) {
        const [planWithNode, newNode] = planCreateNode(
          planWithExpand,
          trimmedText
        );
        executePlan(
          planAddToParent(planWithNode, newNode.id, prevSibling.viewPath, stack)
        );
      } else {
        executePlan(
          planSetEmptyNodePosition(
            planWithExpand,
            prevSibling.viewPath,
            stack,
            0
          )
        );
      }
      return;
    }

    const viewKey = viewPathToString(viewPath);
    const result = planBatchIndent(basePlan, [viewKey], stack, {
      text: trimmedText,
      viewPath,
    });
    if (result) executePlan(result);
  };

  const handleShiftTab = (text: string): void => {
    const basePlan = createPlan();
    const trimmedText = text.trim();

    if (isEmptyNode) {
      if (!parentPath) return;
      const grandParentPath = getParentView(parentPath);
      if (!grandParentPath) return;
      const parentRelationIndex = getRelationIndex(basePlan, parentPath);
      if (parentRelationIndex === undefined) return;

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

    if (!node || node.type !== "text") return;

    const viewKey = viewPathToString(viewPath);
    const result = planBatchOutdent(basePlan, [viewKey], stack, {
      text: trimmedText,
      viewPath,
    });
    if (result) executePlan(result);
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

  const handlePasteMultiLine = (
    items: ParsedLine[],
    currentText: string
  ): void => {
    const { plan: basePlan, viewPath: updatedViewPath } =
      planSaveNodeAndEnsureRelations(
        createPlan(),
        currentText,
        viewPath,
        stack
      );
    const trees = parsedLinesToTrees(items);
    const parentOfSaved = getParentView(updatedViewPath);
    if (!parentOfSaved) {
      const pasteContext = getContext(basePlan, updatedViewPath, stack).push(
        shortID(getNodeIDFromView(basePlan, updatedViewPath)[0]) as ID
      );
      const [planWithNodes, topNodeIDs] = planCreateNodesFromMarkdownTrees(
        basePlan,
        trees,
        pasteContext
      );
      executePlan(
        planAddToParent(planWithNodes, topNodeIDs, updatedViewPath, stack, 0)
      );
      return;
    }
    const savedIndex = getRelationIndex(basePlan, updatedViewPath);
    const insertAt = savedIndex !== undefined ? savedIndex + 1 : 0;
    const pasteContext = getContext(basePlan, parentOfSaved, stack).push(
      shortID(getNodeIDFromView(basePlan, parentOfSaved)[0]) as ID
    );
    const [planWithNodes, topNodeIDs] = planCreateNodesFromMarkdownTrees(
      basePlan,
      trees,
      pasteContext
    );
    executePlan(
      planAddToParent(planWithNodes, topNodeIDs, parentOfSaved, stack, insertAt)
    );
  };

  const handleDelete = (): void => {
    const plan = planDisconnectFromParent(createPlan(), viewPath, stack);
    executePlan(plan);
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
    return <NodeContent />;
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
      onDelete={isEmptyNode ? undefined : handleDelete}
      onPasteMultiLine={handlePasteMultiLine}
    />
  );
}

function InteractiveNodeContent(): JSX.Element {
  const [node] = useNode();
  const [nodeID] = useNodeID();
  const isLoading = useNodeIsLoading();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const virtualType = useRelationItem()?.virtualType;
  const isEmptyNode = isEmptyNodeID(nodeID);

  const isReadonly =
    isInSearchView || isViewingOtherUserContent || virtualType !== undefined;

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
  return <NodeContent />;
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
        ? buildRelationUrl(refInfo.rootRelation, refInfo.scrollTo)
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

function ReferenceGutterIndicator(): JSX.Element {
  return (
    <span
      className="reference-indicator"
      title="Incoming reference"
      aria-hidden="true"
    >
      R
    </span>
  );
}

function VersionIndicator({
  isOtherUser,
}: {
  isOtherUser: boolean;
}): JSX.Element {
  return (
    <span
      className={
        isOtherUser ? "version-indicator-other" : "version-indicator-own"
      }
      title="Alternative version of this list"
      aria-hidden="true"
    >
      ∥
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
  const searchDepth = useSearchDepth();
  const { cardStyle, textStyle, textClassName, relevance } = useItemStyle();
  const defaultCls = isDesktop ? "hover-light-bg" : "";
  const cls =
    className !== undefined ? `${className} hover-light-bg` : defaultCls;
  const clsBody = cardBodyClassName || "ps-0";

  const { user } = useData();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const isConcreteRef = isConcreteRefId(nodeID);
  const virtualType = useRelationItem()?.virtualType;
  const isViewingOtherUser = useIsViewingOtherUserContent();
  const isOtherUser =
    (node && isReferenceNode(node) && node.author !== user.publicKey) ||
    isViewingOtherUser;

  const isVersion =
    virtualType === "version" ||
    (!virtualType && !!node && isReferenceNode(node) && !!node.versionMeta);
  const isSuggestionWithChildren = isSuggestion && isConcreteRef;
  const showExpandCollapse =
    (!isSuggestion && !isVersion && !isConcreteRef) || isSuggestionWithChildren;
  const hasChildren = useNodeHasChildren();

  const contentClass = isSuggestion ? "content-suggestion" : "";

  return (
    <EditorTextProvider>
      <NodeCard
        className={cls}
        cardBodyClassName={clsBody}
        style={cardStyle}
        data-suggestion={isSuggestion ? "true" : undefined}
        data-virtual-type={virtualType || (isVersion ? "version" : undefined)}
        data-other-user={isOtherUser ? "true" : undefined}
        data-deleted={
          node && isReferenceNode(node) && node.deleted ? "true" : undefined
        }
      >
        <div className="indicator-gutter">
          {isSuggestion && <SuggestionIndicator />}
          {isVersion && <VersionIndicator isOtherUser={!!isOtherUser} />}
          {(virtualType === "incoming" || virtualType === "occurrence") && (
            <ReferenceGutterIndicator />
          )}
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
        </div>
        {levels > 0 && <Indent levels={levels} colorLevels={searchDepth} />}
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
        <div className={`w-100 node-content-wrapper ${contentClass}`}>
          <span className={textClassName} style={textStyle}>
            <NodeAutoLink>
              <InteractiveNodeContent />
            </NodeAutoLink>
          </span>
        </div>
        <RightMenu />
      </NodeCard>
    </EditorTextProvider>
  );
}

export const NOTE_TYPE = "note";
