import React from "react";
import { List } from "immutable";
import { LOCAL } from "../core/nodeRef";
import {
  ViewPath,
  useSearchDepth,
  useIsInSearchView,
  useIsExpanded,
  useIsRoot,
  useNodeIndex,
  useCurrentRowID,
  useDisplayText,
  useIsViewingOtherUserContent,
  viewPathToString,
  useCurrentNode,
  getCurrentReferenceForRow,
  useRow,
} from "../rowModel";
import { isEditableNode } from "./temporaryViewState";
import {
  getVisibleParentRow,
  planBatchIndent,
  planBatchOutdent,
} from "./batchOperations";
import {
  getRefLinkTargetInfo,
  getRefTargetInfo,
  getNodeText,
  getNode,
  getNodeContext,
  getSemanticID,
  isEmptySemanticID,
  computeEmptyNodeMetadata,
  isRefNode,
} from "../core/connections";
import { isBlockLinkAny } from "../core/nodeSpans";
import { getBlockLink } from "../core/blockLink";
import { ENTITY_SCHEME_RE } from "../core/entityRecognition";
import { icalFeedLinkPartsOf } from "../core/ical";
import { inlineTargetToHref, linkStyle, linkToHref } from "./linkOperations";
import { ReferenceDisplay } from "./referenceDisplay";
import { MiniEditor, preventEditorBlur } from "./AddNode";
import { useOnToggleExpanded } from "./SelectNodes";
import { useData } from "../DataContext";
import {
  Plan,
  usePlanner,
  planSetEmptyNodePosition,
  planSaveNodeAndEnsureNodes,
  planExpandNode,
  planRemoveEmptyNodePosition,
  planCreateNode,
  planAddToParent,
  planSetRowFocusIntent,
  ParsedLine,
} from "../planner";
import { parsedLinesToTrees, planPasteMarkdownTrees } from "./FileDropZone";
import { planDisconnectFromParent } from "../treeMutations";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeCard } from "../commons/Ui";
import { usePaneIndex, useNavigatePane } from "../SplitPanesContext";
import { buildNodeRouteUrl } from "../navigationUrl";
import {
  PublishReachChip,
  RightMenu,
  usePublishedPaneDocument,
} from "./RightMenu";
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";

export { getNodesInTree } from "../treeTraversal";

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const [rowID] = useCurrentRowID();
  const rawDisplayText = useDisplayText();
  // Feed-as-link rows read by their label; the raw text (with the URL)
  // belongs to edit mode.
  const displayText =
    icalFeedLinkPartsOf(rawDisplayText)?.label ?? rawDisplayText;
  const onToggleExpanded = useOnToggleExpanded();
  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptySemanticID(rowID);
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

function LoadingNode(): JSX.Element {
  return <span className="skeleton-bar" />;
}

function ErrorContent(): JSX.Element {
  return <span className="text-danger">Error: Node not found</span>;
}

const nodeNotFoundCounts = new Map<string, number>();

function logNodeNotFoundDebug({
  data,
  viewPath,
  rowID,
  displayText,
}: {
  data: Data;
  viewPath: ViewPath;
  rowID: ID;
  displayText: string;
}): void {
  if (process.env.DEBUG_NODE_NOT_FOUND !== "1") {
    return;
  }
  const pane = data.panes[viewPath[0] as number];
  const viewKey = viewPathToString(viewPath);
  const logKey = `${window.location.pathname}${window.location.search}|${viewKey}`;
  const count = (nodeNotFoundCounts.get(logKey) || 0) + 1;
  nodeNotFoundCounts.set(logKey, count);
  const dbs = data.knowledgeDBs
    .entrySeq()
    .map(([author, db]) => ({ author, nodeCount: db.nodes.size }))
    .toArray();
  const totalNodeCount = dbs.reduce((sum, db) => sum + db.nodeCount, 0);
  const shouldLog =
    (rowID !== "My Notes" && (count === 1 || count === 5)) ||
    (totalNodeCount > 0 && count % 5 === 0) ||
    count === 30 ||
    count === 100;
  const matchingNodes = data.knowledgeDBs
    .entrySeq()
    .flatMap(([author, db]) =>
      db.nodes
        .valueSeq()
        .filter((node) => getNodeText(node) === displayText)
        .map((node) => ({
          author,
          id: node.id,
          root: node.root,
          parent: node.parent,
          text: getNodeText(node),
        }))
    )
    .toArray();
  const userNode = getNode(data.knowledgeDBs, rowID, LOCAL);
  const paneNode = getNode(data.knowledgeDBs, rowID, pane?.sourceId);
  const rootNode = getNode(data.knowledgeDBs, pane?.rootNodeId, pane?.sourceId);
  const nodeSummary = (
    node: typeof userNode,
    sourceId: SourceId
  ): Record<string, unknown> | null =>
    node
      ? {
          id: node.id,
          root: node.root,
          parent: node.parent,
          text: getNodeText(node),
          semanticID: getSemanticID(data.knowledgeDBs, node, sourceId),
          context: getNodeContext(data.knowledgeDBs, node, sourceId).toArray(),
          children: node.children.toArray(),
        }
      : null;
  if (!shouldLog) {
    return;
  }
  const historyState = window.history.state as { panes?: unknown } | null;
  // eslint-disable-next-line no-console
  console.log("[node-not-found-debug]", {
    count,
    location: window.location.pathname + window.location.search,
    historyPanes: historyState?.panes,
    viewPath,
    viewKey,
    rowID,
    displayText,
    pane,
    user: LOCAL,
    totalNodeCount,
    dbs,
    documents: data.documents.size,
    userNode: nodeSummary(userNode, LOCAL),
    paneNode: nodeSummary(paneNode, pane?.sourceId),
    rootNode: nodeSummary(rootNode, pane?.sourceId),
    matchingNodes,
  });
}

function VersionContent({
  reference,
}: {
  reference: {
    sourceId: SourceId;
    versionMeta?: Row["versionMeta"];
  };
}): JSX.Element {
  const meta = reference.versionMeta;
  const isOtherUser = reference.sourceId !== LOCAL;
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
  reference: {
    id: ID;
    text: string;
    targetLabel: string;
    contextLabels: string[];
    sourceId: SourceId;
    displayAs?: "bidirectional" | "incoming";
    incomingRelevance?: Relevance;
    incomingArgument?: Argument;
    deleted?: boolean;
    versionMeta?: Row["versionMeta"];
  };
}): JSX.Element {
  const row = useRow();
  const { virtualType } = row;

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

function InlineLinkSpan({
  span,
  sourceId,
}: {
  span: Extract<InlineSpan, { kind: "link" }>;
  sourceId: SourceId;
}): JSX.Element {
  const data = useData();
  const navigatePane = useNavigatePane();
  const href = inlineTargetToHref(data, span.targetID, sourceId);
  const style = ENTITY_SCHEME_RE.test(span.targetID)
    ? { color: "var(--violet)" }
    : undefined;
  if (!href) {
    return (
      <span className="inline-link" style={style}>
        {span.text}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="inline-link"
      style={style}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigatePane(href);
      }}
      aria-label={`Navigate to ${span.text}`}
    >
      {span.text}
    </a>
  );
}

// Inline links render as spans within ordinary text: dashed-underlined so
// several links in one sentence stay individually visible, violet when the
// target is an entity. Block-link rows keep their NodeAutoLink wrapper.
function InlineSpans({
  node,
  sourceId,
}: {
  node: GraphNode;
  sourceId: SourceId;
}): JSX.Element {
  return (
    <span className="break-word">
      {node.spans.map((span, index) => {
        const key = `${index}-${span.kind}-${span.text}`;
        if (span.kind === "link") {
          return <InlineLinkSpan key={key} span={span} sourceId={sourceId} />;
        }
        return <React.Fragment key={key}>{span.text}</React.Fragment>;
      })}
    </span>
  );
}

function hasInlineLinks(node: GraphNode | undefined): node is GraphNode {
  return (
    !!node &&
    !isBlockLinkAny(node) &&
    node.spans.some((span) => span.kind === "link")
  );
}

function NodeContent(): JSX.Element {
  const data = useData();
  const row = useRow();
  const reference = getCurrentReferenceForRow(data, row);
  const displayText = useDisplayText();

  if (reference) {
    return <ReferenceContent reference={reference} />;
  }

  if (hasInlineLinks(row.node)) {
    return <InlineSpans node={row.node} sourceId={row.sourceId} />;
  }

  return <span className="break-word">{displayText}</span>;
}

function getPreviousSiblingFromRows(
  rows: List<Row>,
  row: Row
): Row | undefined {
  const { childIndex } = row;
  if (childIndex === undefined || childIndex === 0) {
    return undefined;
  }
  return rows
    .slice(0, row.index)
    .reverse()
    .find(
      (candidate) =>
        candidate.childIndex !== undefined &&
        candidate.parentRef?.sourceId === row.parentRef?.sourceId &&
        candidate.parentRef?.id === row.parentRef?.id &&
        candidate.childIndex < childIndex
    );
}

function EditableContent({ rows }: { rows: List<Row> }): JSX.Element {
  const row = useRow();
  const { parentNode, viewKey, viewPath } = row;
  const paneIndex = usePaneIndex();
  const data = useData();
  const { textStyle } = useItemStyle();
  const { createPlan, executePlan } = usePlanner();
  const currentNode = useCurrentNode();
  const [rowID] = useCurrentRowID();
  const displayText = useDisplayText();
  const prevSibling = getPreviousSiblingFromRows(rows, row);
  const parentPath = row.parentViewPath;
  const viewIsExpanded = useIsExpanded();
  const nodeIsRoot = useIsRoot();
  const nodeIndex = useNodeIndex();
  const isEmptyNode = isEmptySemanticID(rowID);
  const nodeIsExpanded = viewIsExpanded && row.hasChildren;

  const emptyNodeMetadata = computeEmptyNodeMetadata(
    data.publishEventsStatus.temporaryEvents
  );
  const emptyData = parentNode
    ? emptyNodeMetadata.get(parentNode.id)
    : undefined;
  const isRootEmptyNode = isEmptyNode && !parentPath;
  const shouldAutoFocus =
    isEmptyNode && (isRootEmptyNode || emptyData?.paneIndex === paneIndex);
  const escapeFocusPendingRef = React.useRef(false);

  const planWithRowFocusIntent = (plan: Plan, targetViewPath: ViewPath): Plan =>
    planSetRowFocusIntent(plan, {
      paneIndex,
      viewKey: viewPathToString(targetViewPath),
    });

  const handleSave = (text: string, submitted?: boolean): void => {
    const {
      plan: basePlan,
      viewPath: updatedViewPath,
      node: savedNode,
    } = planSaveNodeAndEnsureNodes(
      createPlan(),
      text,
      rowID,
      currentNode,
      viewPath,
      parentNode,
      parentPath,
      paneIndex
    );
    const planWithEscFocus = escapeFocusPendingRef.current
      ? planWithRowFocusIntent(basePlan, updatedViewPath)
      : basePlan;
    // eslint-disable-next-line functional/immutable-data
    escapeFocusPendingRef.current = false;

    if (!submitted || !text.trim()) {
      executePlan(planWithEscFocus);
      return;
    }

    const nextPosition = (() => {
      if (nodeIsRoot || nodeIsExpanded) {
        return {
          parentNode: savedNode,
          parentView: row.view,
          parentViewPath: updatedViewPath,
          insertAt: 0,
        };
      }
      if (!parentNode || !parentPath) {
        return undefined;
      }
      const parentRow = getVisibleParentRow(rows, row);
      if (!parentRow) {
        return undefined;
      }
      return {
        parentNode,
        parentView: parentRow.view,
        parentViewPath: parentRow.viewPath,
        insertAt: (nodeIndex ?? 0) + 1,
      };
    })();

    if (!nextPosition) {
      executePlan(planWithEscFocus);
      return;
    }

    const plan = planSetEmptyNodePosition(
      basePlan,
      nextPosition.parentNode.id,
      nextPosition.parentView,
      nextPosition.parentViewPath,
      paneIndex,
      nextPosition.insertAt
    );
    executePlan(plan);
  };

  const handleTab = (text: string): void => {
    if (!isEmptyNode && !isEditableNode(currentNode)) {
      return;
    }

    const basePlan = createPlan();
    const trimmedText = text.trim();

    if (isEmptyNode) {
      if (!prevSibling || !parentPath) return;
      if (isBlockLinkAny(prevSibling.node)) return;
      const planWithoutEmpty = parentNode
        ? planRemoveEmptyNodePosition(basePlan, parentNode.id)
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
          planAddToParent(planWithNode, newNode, prevSibling.node.id)[0]
        );
      } else {
        executePlan(
          planSetEmptyNodePosition(
            planWithExpand,
            prevSibling.node.id,
            prevSibling.view,
            prevSibling.viewPath,
            paneIndex,
            0
          )
        );
      }
      return;
    }

    const result = planBatchIndent(basePlan, [row], rows, {
      text: trimmedText,
      viewKey,
    });
    if (result) executePlan(result);
  };

  const handleShiftTab = (text: string): void => {
    const basePlan = createPlan();
    const trimmedText = text.trim();

    if (isEmptyNode) {
      if (!parentPath) return;
      const parentRow = getVisibleParentRow(rows, row);
      if (!parentRow?.parentNode) return;
      const grandParentRow = getVisibleParentRow(rows, parentRow);
      if (!grandParentRow) return;
      const parentNodeIndex = row.parentChildIndex;
      if (parentNodeIndex === undefined) return;

      const planWithoutEmpty = parentNode
        ? planRemoveEmptyNodePosition(basePlan, parentNode.id)
        : basePlan;

      if (!trimmedText) {
        executePlan(
          planSetEmptyNodePosition(
            planWithoutEmpty,
            parentRow.parentNode.id,
            grandParentRow.view,
            grandParentRow.viewPath,
            paneIndex,
            parentNodeIndex + 1
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
          parentRow.parentNode.id,
          parentNodeIndex + 1
        )[0]
      );
      return;
    }

    if (!isEditableNode(currentNode)) return;

    const result = planBatchOutdent(basePlan, [row], rows, {
      text: trimmedText,
      viewKey,
    });
    if (result) executePlan(result);
  };

  const handleRequestRowFocus = ({
    viewKey: targetViewKey,
    nodeId,
    rowIndex,
  }: {
    viewKey?: string;
    nodeId?: string;
    rowIndex?: number;
  }): void => {
    const focusTargetNodeId =
      nodeId && !isEmptySemanticID(nodeId as ID) ? nodeId : undefined;
    if (
      targetViewKey === undefined &&
      focusTargetNodeId === undefined &&
      rowIndex === undefined
    ) {
      return;
    }
    const focusPlan = planSetRowFocusIntent(createPlan(), {
      paneIndex,
      viewKey: targetViewKey,
      nodeId: focusTargetNodeId,
      rowIndex,
    });
    executePlan(focusPlan);
  };

  const handlePasteMultiLine = (
    children: ParsedLine[],
    currentText: string
  ): void => {
    const { plan: basePlan, node: savedNode } = planSaveNodeAndEnsureNodes(
      createPlan(),
      currentText,
      rowID,
      currentNode,
      viewPath,
      parentNode,
      parentPath,
      paneIndex
    );
    const trees = parsedLinesToTrees(children);
    if (!parentNode || !parentPath) {
      executePlan(planPasteMarkdownTrees(basePlan, trees, savedNode, 0));
      return;
    }
    const insertAt = nodeIndex !== undefined ? nodeIndex + 1 : 0;
    executePlan(planPasteMarkdownTrees(basePlan, trees, parentNode, insertAt));
  };

  const handleDelete = (): void => {
    if (!parentNode) {
      return;
    }
    const plan = planDisconnectFromParent(
      createPlan(),
      parentNode.id,
      row.node.id
    );
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
    if (parentNode) {
      executePlan(planRemoveEmptyNodePosition(plan, parentNode.id));
    }
  };

  if (!isEmptyNode && !isEditableNode(currentNode)) {
    return <NodeContent />;
  }

  return (
    <MiniEditor
      key={`${viewPathToString(viewPath)}:${nodeIndex}`}
      initialText={displayText}
      style={textStyle}
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

function InteractiveNodeContent({ rows }: { rows: List<Row> }): JSX.Element {
  const data = useData();
  const row = useRow();
  const { viewPath } = row;
  const currentNode = useCurrentNode();
  const [rowID] = useCurrentRowID();
  const isLoading = useNodeIsLoading();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const { virtualType } = row;
  const isEmptyNode = isEmptySemanticID(rowID);
  const displayText = useDisplayText();
  const reference = getCurrentReferenceForRow(data, row);

  const isReadonly =
    isInSearchView || isViewingOtherUserContent || virtualType !== undefined;

  if (isLoading) {
    return <LoadingNode />;
  }

  // For empty placeholder nodes, render EditableContent only if not readonly
  if (isEmptyNode) {
    return isReadonly ? <></> : <EditableContent rows={rows} />;
  }

  if (!currentNode && !reference && displayText === "") {
    logNodeNotFoundDebug({
      data,
      viewPath,
      rowID,
      displayText,
    });
    return <ErrorContent />;
  }

  if (isEditableNode(currentNode) && !isReadonly) {
    return <EditableContent rows={rows} />;
  }

  // Read-only content
  return <NodeContent />;
}

function NodeAutoLink({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const data = useData();
  const { knowledgeDBs, documents, documentByFilePath } = data;
  const row = useRow();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const publishedDocument = usePublishedPaneDocument();
  const effectiveAuthor = row.sourceId;
  const { virtualType } = row;
  const blockLink =
    virtualType === "incoming"
      ? undefined
      : getBlockLink(row.node, row.sourceId);
  if (blockLink) {
    const href = linkToHref(
      data,
      blockLink,
      virtualType === "version" ? "target" : "link"
    );
    if (href) {
      return (
        <>
          <a
            href={href}
            className="reference-link-btn"
            style={linkStyle(blockLink)}
            onClick={(e) => {
              e.preventDefault();
              navigatePane(href);
            }}
            aria-label={`Navigate to ${displayText}`}
          >
            {children}
          </a>
          {publishedDocument && virtualType === undefined && (
            <PublishReachChip
              paneDocument={publishedDocument}
              node={row.node}
            />
          )}
        </>
      );
    }
  }

  const node = getCurrentReferenceForRow(data, row);

  if (!node) {
    return <>{children}</>;
  }

  const refInfo =
    virtualType === "version"
      ? getRefTargetInfo(node.id, knowledgeDBs, effectiveAuthor)
      : getRefLinkTargetInfo(
          node.id,
          knowledgeDBs,
          effectiveAuthor,
          documents,
          documentByFilePath
        );
  if (!refInfo) {
    return <>{children}</>;
  }
  const href = refInfo.rootNodeId
    ? buildNodeRouteUrl(
        refInfo.rootNodeId,
        refInfo.sourceId,
        refInfo.scrollToId
      )
    : "#";
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

export const INDENTATION = 25;
const ARROW_WIDTH = 0;

function Indent({
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

function IncomingRefGutterIndicator(): JSX.Element {
  return (
    <span
      className="maybe-relevant-indicator"
      title="Suggested link — judge it (! ? ~ + -) to place it"
      aria-hidden="true"
    >
      ?
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
  rows,
}: {
  className?: string;
  cardBodyClassName?: string;
  isSuggestion?: boolean;
  rows: List<Row>;
}): JSX.Element | null {
  const row = useRow();
  const levels = getLevels(row.viewPath);
  const searchDepth = useSearchDepth();
  const { cardStyle, textStyle, textClassName, relevance } = useItemStyle();
  const cls =
    className !== undefined ? `${className} hover-light-bg` : "hover-light-bg";
  const clsBody = cardBodyClassName || "ps-0";

  const data = useData();
  const isConcreteRef = isRefNode(row.node);
  const { virtualType } = row;
  const currentNode = useCurrentNode();
  const isViewingOtherUser = useIsViewingOtherUserContent();
  const node = getCurrentReferenceForRow(data, row);
  const isOtherUser = (node && node.sourceId !== LOCAL) || isViewingOtherUser;

  const isVersion = virtualType === "version" || !!node?.versionMeta;
  const isSuggestionWithChildren =
    isSuggestion && (isConcreteRef || !!currentNode);
  const showExpandCollapse =
    (!isSuggestion && !isVersion && !isConcreteRef) || isSuggestionWithChildren;
  const { hasChildren } = row;

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
          node && "deleted" in node && node.deleted ? "true" : undefined
        }
      >
        <div className="indicator-gutter">
          {isSuggestion && <SuggestionIndicator />}
          {isVersion && <VersionIndicator isOtherUser={!!isOtherUser} />}
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
              <InteractiveNodeContent rows={rows} />
            </NodeAutoLink>
          </span>
        </div>
        <RightMenu />
      </NodeCard>
    </EditorTextProvider>
  );
}

export const NOTE_TYPE = "note";
