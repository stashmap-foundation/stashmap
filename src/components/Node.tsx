import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useViewPath,
  ViewPath,
  useSearchDepth,
  useIsInSearchView,
  useIsExpanded,
  useIsRoot,
  useRelationIndex,
  useCurrentItemID,
  usePreviousSibling,
  useDisplayText,
  getParentView,
  getRelationForView,
  getRelationIndex,
  getItemIDFromView,
  useIsViewingOtherUserContent,
  useCurrentEdge,
  viewPathToString,
  useEffectiveAuthor,
  useCurrentRelation,
  getCurrentReferenceForView,
} from "../ViewContext";
import { isEditableRelation } from "./TemporaryViewContext";
import { planBatchIndent, planBatchOutdent } from "./batchOperations";
import {
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isEmptyNodeID,
  isConcreteRefId,
  computeEmptyNodeMetadata,
} from "../connections";
import { ReferenceDisplay } from "./referenceDisplay";
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
import { parsedLinesToTrees, planPasteMarkdownTrees } from "./FileDropZone";
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
  const result = getChildNodes(
    data,
    viewPath,
    stack,
    pane.rootRelation,
    pane.author,
    pane.typeFilters
  );
  return result.paths.size > 0;
}

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const [nodeID] = useCurrentItemID();
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

function VersionContent({ reference }: { reference: ReferenceRow }): JSX.Element {
  const { user } = useData();
  const meta = reference.versionMeta;
  const isOtherUser = reference.author !== user.publicKey;
  const dateStr = meta ? new Date(meta.updated).toLocaleString() : "";
  return (
    <span className="break-word" data-testid="reference-row">
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

function ReferenceContent({
  reference,
}: {
  reference: ReferenceRow;
}): JSX.Element {
  const relationItem = useCurrentEdge();
  const virtualType = relationItem?.virtualType;

  if (virtualType === "version" || reference.versionMeta) {
    return <VersionContent reference={reference} />;
  }

  if (virtualType === "suggestion") {
    return (
      <span className="break-word" data-testid="reference-row">
        {reference.targetLabel}
      </span>
    );
  }

  return <ReferenceDisplay reference={reference} />;
}

function NodeContent(): JSX.Element {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const virtualType = useCurrentEdge()?.virtualType;
  const reference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType
  );
  const displayText = useDisplayText();

  if (reference) {
    return <ReferenceContent reference={reference} />;
  }

  return <span className="break-word">{displayText}</span>;
}

function EditableContent(): JSX.Element {
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const paneIndex = usePaneIndex();
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const currentRelation = useCurrentRelation();
  const [nodeID] = useCurrentItemID();
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
    const [targetNodeID] = getItemIDFromView(plan, targetViewPath);
    return planSetRowFocusIntent(plan, {
      paneIndex,
      viewKey: viewPathToString(targetViewPath),
      nodeId: targetNodeID,
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
    if (!isEmptyNode && !isEditableRelation(currentRelation)) {
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
          planAddToParent(
            planWithNode,
            newNode,
            prevSibling.viewPath,
            stack
          )[0]
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
          newNode,
          grandParentPath,
          stack,
          parentRelationIndex + 1
        )[0]
      );
      return;
    }

    if (!isEditableRelation(currentRelation)) return;

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
      executePlan(
        planPasteMarkdownTrees(basePlan, trees, updatedViewPath, stack, 0)
      );
      return;
    }
    const savedIndex = getRelationIndex(basePlan, updatedViewPath);
    const insertAt = savedIndex !== undefined ? savedIndex + 1 : 0;
    executePlan(
      planPasteMarkdownTrees(basePlan, trees, parentOfSaved, stack, insertAt)
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

  if (!isEmptyNode && !isEditableRelation(currentRelation)) {
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
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const currentRelation = useCurrentRelation();
  const [nodeID] = useCurrentItemID();
  const isLoading = useNodeIsLoading();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const virtualType = useCurrentEdge()?.virtualType;
  const isEmptyNode = isEmptyNodeID(nodeID);
  const displayText = useDisplayText();
  const reference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType
  );

  const isReadonly =
    isInSearchView || isViewingOtherUserContent || virtualType !== undefined;

  if (isLoading) {
    return <LoadingNode />;
  }

  // For empty placeholder nodes, render EditableContent only if not readonly
  if (isEmptyNode) {
    return isReadonly ? <></> : <EditableContent />;
  }

  if (!currentRelation && !reference && displayText === "") {
    return <ErrorContent />;
  }

  if (isEditableRelation(currentRelation) && !isReadonly) {
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
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const virtualType = useCurrentEdge()?.virtualType;
  const node = getCurrentReferenceForView(data, viewPath, stack, virtualType);

  if (node) {
    const refInfo =
      virtualType === "version"
        ? getRefTargetInfo(node.id, knowledgeDBs, effectiveAuthor)
        : getRefLinkTargetInfo(node.id, knowledgeDBs, effectiveAuthor);
    if (refInfo) {
      const href = refInfo.rootRelation
        ? buildRelationUrl(refInfo.rootRelation, refInfo.scrollToId)
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

function OccurrenceGutterIndicator(): JSX.Element {
  return (
    <span className="reference-indicator" title="Occurrence" aria-hidden="true">
      =
    </span>
  );
}

function IncomingRefGutterIndicator(): JSX.Element {
  return (
    <span
      className="reference-indicator"
      title="Incoming Reference"
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
  const [nodeID] = useCurrentItemID();
  const data = useData();
  const stack = usePaneStack();
  const currentRelation = useCurrentRelation();
  const isConcreteRef = isConcreteRefId(nodeID);
  const virtualType = useCurrentEdge()?.virtualType;
  const isViewingOtherUser = useIsViewingOtherUserContent();
  const node = getCurrentReferenceForView(data, viewPath, stack, virtualType);
  const isOtherUser =
    (node && node.author !== user.publicKey) ||
    isViewingOtherUser;

  const isVersion =
    virtualType === "version" ||
    (!virtualType && !!node?.versionMeta);
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
        data-deleted={node?.deleted ? "true" : undefined}
      >
        <div className="indicator-gutter">
          {isSuggestion && <SuggestionIndicator />}
          {isVersion && <VersionIndicator isOtherUser={!!isOtherUser} />}
          {virtualType === "occurrence" && <OccurrenceGutterIndicator />}
          {virtualType === "incoming" && <IncomingRefGutterIndicator />}
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
