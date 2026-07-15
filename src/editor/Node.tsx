import React from "react";
import { List } from "immutable";
import { LOCAL, nodeRefKey } from "../core/nodeRef";
import {
  ViewPath,
  useSearchDepth,
  useIsInSearchView,
  useIsExpanded,
  useIsRoot,
  useNodeIndex,
  useDisplayText,
  useIsViewingOtherUserContent,
  viewPathToString,
  useCurrentNode,
  useRow,
  updateView,
  addNodesToLastElement,
} from "../rowModel";
import { isEditableNode } from "./temporaryViewState";
import {
  getVisibleParentRow,
  planBatchIndent,
  planBatchOutdent,
} from "./batchOperations";
import {
  getNodeText,
  getNode,
  getNodeContext,
  isEmptyNodeID,
  computeEmptyNodeMetadata,
} from "../core/connections";
import { isFileLinkHref, spansText, spansToMarkdown } from "../core/nodeSpans";
import { classifyLinkHref, externalLinkUrl } from "../core/linkPath";
import {
  calendarEntryTarget,
  calendarFeedHref,
  calendarFeedUrl,
  displayTextOf,
  hiddenPastEntryCount,
  isBareIcalFeedUrl,
  isCalendarEntryId,
  isCalendarEntryPlacement,
} from "../core/ical";
import { useCalendarFeeds } from "../CalendarFeedContext";
import {
  inlineLinkToHref,
  isDeadLinkTarget,
  resolveDocumentTarget,
} from "./linkOperations";
import { IncomingPart, ReferenceDisplay } from "./referenceDisplay";
import { MiniEditor, ReciprocalLink, preventEditorBlur } from "./AddNode";
import { linkStyleForHref } from "./editorDom";
import { useOnToggleExpanded } from "./SelectNodes";
import { useData } from "../DataContext";
import {
  planMaterializeComputedRow,
  planSetDocumentPublishState,
} from "../core/plan";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { getWorkspaceNode } from "../core/knowledge";
import {
  Plan,
  usePlanner,
  planSetEmptyNodePosition,
  planSaveNodeAndEnsureNodes,
  planExpandNode,
  planUpdateViews,
  planRemoveEmptyNodePosition,
  planAddSpansToParent,
  planSetRowFocusIntent,
  ParsedLine,
} from "../planner";
import { parsedLinesToTrees, planPasteMarkdownTrees } from "./FileDropZone";
import { planDisconnectFromParent } from "../treeMutations";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeCard } from "../commons/Ui";
import { usePaneIndex, useNavigatePane } from "../SplitPanesContext";
import { RightMenu, usePublishedPaneDocument } from "./RightMenu";
import { unpublishedLinkTargetForHref } from "./publishReach";
import { useItemStyle } from "./useItemStyle";
import { EditorTextProvider } from "./EditorTextContext";
import {
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
} from "../core/graphLookup";
import { findReciprocalLinkItem } from "../buildReferenceRow";

export { getNodesInTree } from "../treeTraversal";

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const row = useRow();
  const rawDisplayText = useDisplayText();
  // Feed-as-link rows read by their label; the raw text (with the URL)
  // belongs to edit mode.
  const displayText = displayTextOf(rawDisplayText);
  const onToggleExpanded = useOnToggleExpanded();
  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptyNodeID(row.node.id);
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

// The action row's content: a button in row position, obviously not
// content — the wallet's "Register as Shareholder" element, shared
// instead of reinvented. The label is the action; it always says what a
// click does. State lives on the action row's own view.
function PastDatesActionRow(): JSX.Element {
  const data = useData();
  const row = useRow();
  const { feeds } = useCalendarFeeds();
  const { createPlan, executePlan } = usePlanner();
  const feedUrl = row.parentNode ? calendarFeedUrl(row.parentNode) : undefined;
  const entries = feedUrl ? feeds.get(feedUrl) : undefined;
  const pastCount =
    entries && row.parentNode
      ? hiddenPastEntryCount(
          row.parentNode.children
            .toArray()
            .map(
              (childId) =>
                calendarEntryTarget(
                  getNode(data.knowledgeDBs, childId, row.sourceId)
                ) ?? childId
            ),
          entries,
          Date.now()
        )
      : 0;
  const showPast = row.view.showPastEntries === true;
  const label = showPast
    ? "Hide past dates"
    : `Show ${pastCount} past ${pastCount === 1 ? "date" : "dates"}`;
  const onToggle = (): void => {
    executePlan(
      planUpdateViews(
        createPlan(),
        updateView(data.views, row.viewPath, {
          ...row.view,
          showPastEntries: !showPast,
        })
      )
    );
  };
  return (
    <button
      type="button"
      className="action-row-btn"
      onClick={onToggle}
      onMouseDown={preventEditorBlur}
      aria-label={label}
      aria-pressed={showPast}
    >
      {label}
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
  nodeID,
  displayText,
}: {
  data: Data;
  viewPath: ViewPath;
  nodeID: ID;
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
    count === 1 ||
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
  const userNode = getNode(data.knowledgeDBs, nodeID, LOCAL);
  const paneNode = getNode(data.knowledgeDBs, nodeID, pane?.sourceId);
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
    nodeID,
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
  sourceId,
  meta,
}: {
  sourceId: SourceId;
  meta: Row["versionMeta"];
}): JSX.Element {
  const isOtherUser = sourceId !== LOCAL;
  const dateStr = meta ? new Date(meta.updated).toLocaleString() : "";
  return (
    <span className="break-word" data-testid="reference-row">
      {dateStr}
      <span style={{ fontStyle: "normal" }}>
        {isOtherUser && " \u{1F464}"}
        {meta && meta.direct && (
          <>
            {" "}
            <span style={{ color: "var(--yellow)" }}>
              ±{meta.addCount + meta.removeCount}
            </span>
          </>
        )}
        {meta && !meta.direct && meta.addCount > 0 && (
          <>
            {" "}
            <span style={{ color: "var(--green)" }}>+{meta.addCount}</span>
          </>
        )}
        {meta && !meta.direct && meta.removeCount > 0 && (
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
    displayAs?: "incoming";
    incomingRelevance?: Relevance;
    incomingArgument?: Argument;
  };
}): JSX.Element {
  const data = useData();
  const row = useRow();
  const navigatePane = useNavigatePane();
  const href = inlineLinkToHref(
    data,
    `#${reference.id}`,
    row.node,
    reference.sourceId
  );
  if (!href) return <ReferenceDisplay reference={reference} />;
  return (
    <a
      href={href}
      className="reference-link-btn"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigatePane(href);
      }}
      aria-label={`Navigate to ${reference.text}`}
    >
      <ReferenceDisplay reference={reference} />
    </a>
  );
}

function LinkReachChip({
  span,
  node,
  sourceId,
}: {
  span: Extract<InlineSpan, { kind: "link" }>;
  node: GraphNode;
  sourceId: SourceId;
}): JSX.Element | null {
  const data = useData();
  const paneDocument = usePublishedPaneDocument();
  const { createPlan, executePlan } = usePlanner();
  const target = unpublishedLinkTargetForHref(
    data.knowledgeDBs,
    data.documents,
    data.documentByFilePath,
    paneDocument,
    node,
    sourceId,
    span.href
  );
  if (!paneDocument || !target) return null;
  const grant = (): void => {
    const state = publishStateOf(paneDocument.frontMatter);
    executePlan(
      planSetDocumentPublishState(createPlan(), target.docId, {
        entities: [
          ...new Set([
            ...paneDocument.topNodeShortIds,
            ...(state?.entities ?? []),
          ]),
        ],
        relays: state?.relays,
        paused: false,
      })
    );
  };
  return (
    <button
      type="button"
      className="publish-reach-chip"
      onClick={(event) => {
        event.stopPropagation();
        grant();
      }}
      aria-label={`publish linked document ${target.title || target.docId}`}
    >
      not published
    </button>
  );
}

function reciprocalTarget(
  data: Data,
  node: GraphNode,
  sourceId: SourceId,
  href: string
): ResolvedNode | undefined {
  const graph = graphLookupFromData(data);
  const targetClass = classifyLinkHref(href);
  if (
    targetClass === "entity" ||
    targetClass === "node" ||
    targetClass === "calendar"
  ) {
    return getNodeInSource(graph, { sourceId, id: href.slice(1) });
  }
  if (!isFileLinkHref(href)) {
    return undefined;
  }
  const hashIndex = href.lastIndexOf("#");
  const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const document = resolveDocumentTarget(data, node, sourceId, path);
  const rootID = document?.topNodeShortIds[0];
  return rootID && document
    ? getNodeInSource(graph, { sourceId: document.sourceId, id: rootID })
    : undefined;
}

function reciprocalLinks(
  data: Data,
  node: GraphNode,
  sourceId: SourceId
): ReciprocalLink[] {
  const graph = graphLookupFromData(data);
  const source = getNodeInSource(graph, { sourceId, id: node.id });
  if (!source) return [];
  const initial: { links: ReciprocalLink[]; targets: string[] } = {
    links: [],
    targets: [],
  };
  return node.spans.reduce((result, span, index) => {
    if (span.kind !== "link") return result;
    const target = reciprocalTarget(data, node, sourceId, span.href);
    if (!target) return result;
    const key = nodeRefKey(target.ref);
    if (result.targets.includes(key)) return result;
    const reciprocal = findReciprocalLinkItem(graph, data, source, target);
    if (!reciprocal) return result;
    return {
      links: [
        ...result.links,
        {
          spanIndex: index,
          relevance: reciprocal.relevance,
          argument: reciprocal.argument,
        },
      ],
      targets: [...result.targets, key],
    };
  }, initial).links;
}

function InlineLinkSpan({
  span,
  node,
  sourceId,
  reciprocal,
}: {
  span: Extract<InlineSpan, { kind: "link" }>;
  node: GraphNode;
  sourceId: SourceId;
  reciprocal?: ReciprocalLink;
}): JSX.Element {
  const data = useData();
  const navigatePane = useNavigatePane();
  const row = useRow();
  const isSearchResult = row.virtualType === "search";
  const calendarContent =
    !isSearchResult &&
    (calendarFeedUrl(node) !== undefined ||
      (row.standsFor !== undefined && isCalendarEntryId(row.standsFor.id)));
  const externalUrl = calendarContent ? undefined : externalLinkUrl(span.href);
  const dead = isDeadLinkTarget(data, span.href, node, sourceId);
  const internalHref =
    dead || calendarContent
      ? undefined
      : inlineLinkToHref(data, span.href, node, sourceId);
  const href = externalUrl ?? internalHref;
  const style: React.CSSProperties = isSearchResult
    ? { fontStyle: "italic", textDecoration: "none" }
    : linkStyleForHref(span.href, dead);
  const externalPart =
    !isSearchResult && externalUrl ? (
      <sup
        className="incoming-part external-link-part"
        data-link-furniture="external"
        aria-hidden="true"
      >
        ↗
      </sup>
    ) : null;
  const deadPart = dead ? (
    <sup
      className="incoming-part dead-link-part"
      data-link-furniture="dead"
      aria-hidden="true"
    >
      †
    </sup>
  ) : null;
  if (calendarContent) {
    return (
      <>
        <span data-href={span.href} data-target={span.href}>
          {span.text}
        </span>
        {reciprocal && (
          <IncomingPart
            relevance={reciprocal.relevance}
            argument={reciprocal.argument}
            ariaHidden
          />
        )}
        <LinkReachChip span={span} node={node} sourceId={sourceId} />
      </>
    );
  }
  if (!href) {
    return (
      <>
        <span
          role="link"
          className="inline-link"
          style={style}
          data-href={span.href}
          data-target={span.href}
          data-link-dead={dead ? "true" : undefined}
          aria-disabled={dead || undefined}
          aria-label={
            dead ? `${span.text}. Target no longer exists` : undefined
          }
        >
          {span.text}
        </span>
        {externalPart}
        {deadPart}
        {reciprocal && (
          <IncomingPart
            relevance={reciprocal.relevance}
            argument={reciprocal.argument}
            ariaHidden
          />
        )}
        <LinkReachChip span={span} node={node} sourceId={sourceId} />
      </>
    );
  }
  if (externalUrl) {
    return (
      <>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-link"
          style={style}
          data-href={span.href}
          data-target={span.href}
          aria-label={`${span.text} (opens externally)`}
        >
          {span.text}
        </a>
        {externalPart}
      </>
    );
  }
  return (
    <>
      <a
        href={href}
        className="inline-link"
        style={style}
        data-href={span.href}
        data-target={span.href}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigatePane(href);
        }}
        aria-label={`Navigate to ${span.text}`}
      >
        {span.text}
      </a>
      {reciprocal && (
        <IncomingPart
          relevance={reciprocal.relevance}
          argument={reciprocal.argument}
          ariaHidden
        />
      )}
      <LinkReachChip span={span} node={node} sourceId={sourceId} />
    </>
  );
}

function InlineSpans({
  node,
  sourceId,
}: {
  node: GraphNode;
  sourceId: SourceId;
}): JSX.Element {
  const data = useData();
  const reciprocals = reciprocalLinks(data, node, sourceId);
  return (
    <span className="break-word">
      {node.spans.map((span, index) => {
        const key = `${index}-${span.kind}-${span.text}`;
        if (span.kind === "link") {
          return (
            <InlineLinkSpan
              key={key}
              span={span}
              node={node}
              sourceId={sourceId}
              reciprocal={reciprocals.find(
                (candidate) => candidate.spanIndex === index
              )}
            />
          );
        }
        return <React.Fragment key={key}>{span.text}</React.Fragment>;
      })}
    </span>
  );
}

function hasInlineLinks(node: GraphNode | undefined): node is GraphNode {
  return !!node && node.spans.some((span) => span.kind === "link");
}

function NodeContent(): JSX.Element {
  const row = useRow();
  const { reference } = row;
  const displayText = useDisplayText();

  // A rename suggestion: replacement-shaped — my text on the way out
  // (strikethrough, the (x) treatment reused), theirs beside it.
  if (row.renameSuggestion) {
    return (
      <span className="break-word" data-testid="reference-row">
        {row.sourceId !== LOCAL && "\u{1F464} "}
        <span style={{ textDecoration: "line-through" }}>
          {row.renameSuggestion.mine}
        </span>{" "}
        {row.renameSuggestion.theirs}
      </span>
    );
  }

  // Footer proposals render straight from their node — no parallel
  // presentation blob. A suggestion is its label; a version is its meta.
  if (row.virtualType === "suggestion") {
    return (
      <span className="break-word" data-testid="reference-row">
        {displayTextOf(displayText)}
      </span>
    );
  }
  if (row.virtualType === "version") {
    return <VersionContent sourceId={row.sourceId} meta={row.versionMeta} />;
  }

  if (row.virtualType === undefined && hasInlineLinks(row.node)) {
    return <InlineSpans node={row.node} sourceId={row.sourceId} />;
  }

  if (row.virtualType === "search" && hasInlineLinks(row.node)) {
    return (
      <span
        data-testid="reference-row"
        style={{ fontStyle: "italic", textDecoration: "none" }}
      >
        <InlineSpans node={row.node} sourceId={row.sourceId} />
      </span>
    );
  }

  if (reference) {
    return <ReferenceContent reference={reference} />;
  }

  if (hasInlineLinks(row.node)) {
    return <InlineSpans node={row.node} sourceId={row.sourceId} />;
  }

  // Read display goes through the one display-text rule (feed links read
  // by their label); raw text belongs to edit mode only.
  return <span className="break-word">{displayTextOf(displayText)}</span>;
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
  const navigatePane = useNavigatePane();
  const { feeds: calendarFeeds } = useCalendarFeeds();
  const currentNode = useCurrentNode();
  const prevSibling = getPreviousSiblingFromRows(rows, row);
  const parentPath = row.parentViewPath;
  const viewIsExpanded = useIsExpanded();
  const nodeIsRoot = useIsRoot();
  const nodeIndex = useNodeIndex();
  const isEmptyNode = isEmptyNodeID(row.node.id);
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

  const editorSpans = currentNode.spans;
  const feedUrl = calendarFeedUrl(currentNode);
  const calendarContent =
    feedUrl !== undefined ||
    isCalendarEntryPlacement(currentNode, parentNode ?? undefined);
  const reciprocals = reciprocalLinks(data, row.node, row.sourceId);
  const deadLinkIndexes = editorSpans.flatMap((span, index) =>
    span.kind === "link" &&
    isDeadLinkTarget(data, span.href, row.node, row.sourceId)
      ? [index]
      : []
  );
  const externalLinkIndexes = calendarContent
    ? []
    : editorSpans.flatMap((span, index) =>
        span.kind === "link" && externalLinkUrl(span.href) ? [index] : []
      );
  const calendarLinkIndexes = calendarContent ? [0] : [];
  const persistedSpans = (spans: InlineSpan[]): InlineSpan[] => {
    const text = spansText(spans).trim();
    if (feedUrl && spans.every((span) => span.kind === "text")) {
      return [{ kind: "link", href: calendarFeedHref(feedUrl), text }];
    }
    return isBareIcalFeedUrl(text)
      ? [{ kind: "link", href: calendarFeedHref(text), text }]
      : spans;
  };

  const handleSave = async (
    spans: InlineSpan[],
    submitted?: boolean
  ): Promise<void> => {
    const nextSpans = persistedSpans(spans);
    // Write gestures take first; read gestures read. A computed row's
    // save materializes the row before the text lands — and an unchanged
    // text writes nothing at all (blur/Escape must not take).
    const takeResult = ((): [Plan, GraphNode, ViewPath] | undefined => {
      if (!row.materialize) {
        return [createPlan(), currentNode, viewPath];
      }
      // Enter is a write gesture (it opens a position below — the row
      // materializes, per the machine-feeds law); plain blur/Escape with
      // unchanged text reads only.
      if (
        !submitted &&
        spansToMarkdown(nextSpans) === spansToMarkdown(row.node.spans)
      ) {
        return undefined;
      }
      const [plan, takenNode] = planMaterializeComputedRow(createPlan(), row);
      return [
        plan,
        takenNode,
        addNodesToLastElement(viewPath, takenNode.id) as ViewPath,
      ];
    })();
    if (!takeResult) {
      return;
    }
    const [materializedStart, takenNode, takenViewPath] = takeResult;
    const {
      plan: basePlan,
      viewPath: updatedViewPath,
      node: savedNode,
    } = planSaveNodeAndEnsureNodes(
      materializedStart,
      nextSpans,
      row.materialize ? row.node.id : takenNode.id,
      takenNode,
      takenViewPath,
      parentNode,
      parentPath,
      paneIndex
    );
    const planWithEscFocus = escapeFocusPendingRef.current
      ? planWithRowFocusIntent(basePlan, updatedViewPath)
      : basePlan;
    // eslint-disable-next-line functional/immutable-data
    escapeFocusPendingRef.current = false;

    if (!submitted || spansText(spans).trim() === "") {
      await executePlan(planWithEscFocus);
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
      // A freshly materialized row has no childIndex; its real position
      // comes from the plan's current children.
      const insertAt = (() => {
        if (nodeIndex !== undefined) return nodeIndex + 1;
        const parent = getWorkspaceNode(basePlan.knowledgeDBs, parentNode.id);
        const index = parent ? parent.children.indexOf(savedNode.id) : -1;
        return index >= 0 ? index + 1 : 0;
      })();
      return {
        parentNode,
        parentView: parentRow.view,
        parentViewPath: parentRow.viewPath,
        insertAt,
      };
    })();

    if (!nextPosition) {
      await executePlan(planWithEscFocus);
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
    await executePlan(plan);
  };

  const handleTab = (spans: InlineSpan[]): void => {
    if (!isEmptyNode && !isEditableNode(currentNode)) return;

    const basePlan = createPlan();
    const trimmedText = spansText(spans).trim();

    if (isEmptyNode) {
      if (!prevSibling || !parentPath) return;
      // Indenting onto a computed row takes it first.
      const [planMaterialized, takenPrevSibling] = planMaterializeComputedRow(
        basePlan,
        prevSibling
      );
      const takenViewPath = addNodesToLastElement(
        prevSibling.viewPath,
        takenPrevSibling.id
      );
      const planWithoutEmpty = parentNode
        ? planRemoveEmptyNodePosition(planMaterialized, parentNode.id)
        : planMaterialized;
      const planWithExpand = planExpandNode(
        planWithoutEmpty,
        prevSibling.view,
        takenViewPath
      );

      if (trimmedText) {
        executePlan(
          planAddSpansToParent(
            planWithExpand,
            persistedSpans(spans),
            takenPrevSibling,
            undefined,
            undefined,
            undefined
          )
        );
      } else {
        executePlan(
          planSetEmptyNodePosition(
            planWithExpand,
            takenPrevSibling.id,
            prevSibling.view,
            takenViewPath,
            paneIndex,
            0
          )
        );
      }
      return;
    }

    const result = planBatchIndent(basePlan, [row], rows, {
      spans: persistedSpans(spans),
      viewKey,
    });
    if (result) executePlan(result);
  };

  const handleShiftTab = (spans: InlineSpan[]): void => {
    const basePlan = createPlan();
    const trimmedText = spansText(spans).trim();

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

      executePlan(
        planAddSpansToParent(
          planWithoutEmpty,
          persistedSpans(spans),
          parentRow.parentNode,
          parentNodeIndex + 1,
          undefined,
          undefined
        )
      );
      return;
    }

    if (!isEditableNode(currentNode)) return;

    const result = planBatchOutdent(basePlan, [row], rows, {
      spans: persistedSpans(spans),
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
      nodeId && !isEmptyNodeID(nodeId) ? nodeId : undefined;
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
    currentSpans: InlineSpan[]
  ): void => {
    const { plan: basePlan, node: savedNode } = planSaveNodeAndEnsureNodes(
      createPlan(),
      persistedSpans(currentSpans),
      row.node.id,
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

  const handleActivateLink = async (
    href: string,
    spans: InlineSpan[]
  ): Promise<void> => {
    const externalUrl = externalLinkUrl(href);
    if (externalUrl) {
      handleSave(spans);
      window.open(externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    await handleSave(spans);
    const targetHref = inlineLinkToHref(
      { ...data, calendarFeeds },
      href,
      row.node,
      row.sourceId
    );
    if (targetHref) navigatePane(targetHref);
  };

  return (
    <>
      <MiniEditor
        key={`${viewPathToString(viewPath)}:${nodeIndex}`}
        initialSpans={editorSpans}
        reciprocalLinks={reciprocals}
        deadLinkIndexes={deadLinkIndexes}
        externalLinkIndexes={externalLinkIndexes}
        calendarLinkIndexes={calendarLinkIndexes}
        style={textStyle}
        onSave={handleSave}
        onTab={handleTab}
        onShiftTab={handleShiftTab}
        onClose={isEmptyNode ? handleClose : undefined}
        autoFocus={shouldAutoFocus}
        ariaLabel={
          isEmptyNode ? "new node editor" : `edit ${spansText(editorSpans)}`
        }
        onEscape={handleEscapeRequest}
        onRequestRowFocus={handleRequestRowFocus}
        onDelete={isEmptyNode ? undefined : handleDelete}
        onPasteMultiLine={handlePasteMultiLine}
        onActivateLink={handleActivateLink}
      />
      {editorSpans.map((span) =>
        span.kind === "link" ? (
          <LinkReachChip
            key={`${span.href}-${span.text}`}
            span={span}
            node={row.node}
            sourceId={row.sourceId}
          />
        ) : null
      )}
    </>
  );
}

function InteractiveNodeContent({ rows }: { rows: List<Row> }): JSX.Element {
  const data = useData();
  const row = useRow();
  const { viewPath, virtualType, reference } = row;
  const currentNode = useCurrentNode();
  const isLoading = useNodeIsLoading();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isEmptyNode = isEmptyNodeID(row.node.id);
  const displayText = useDisplayText();

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
      nodeID: row.node.id,
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
      title="Suggestion — a version of this list has this row"
      aria-hidden="true"
    >
      @
    </span>
  );
}

// Incoming references speak ↩ everywhere — the gutter, the filter button,
// the link cluster. Never a judgment symbol: nobody judged anything.
function IncomingRefGutterIndicator(): JSX.Element {
  return (
    <span
      className="incoming-indicator"
      title="Incoming link — judge it (! ? ~ + -) to place it"
      aria-hidden="true"
    >
      ↩
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

  const { virtualType } = row;
  const currentNode = useCurrentNode();
  const calendarType = (() => {
    if (isSuggestion || virtualType !== undefined) return undefined;
    if (calendarFeedUrl(currentNode) !== undefined) return "Calendar";
    return isCalendarEntryId(row.standsFor?.id ?? currentNode.id)
      ? "Date"
      : undefined;
  })();
  const isViewingOtherUser = useIsViewingOtherUserContent();
  const node = row.reference;
  const isOtherUser = (node && node.sourceId !== LOCAL) || isViewingOtherUser;

  const isVersion = virtualType === "version";
  const isSuggestionWithChildren = isSuggestion && !!currentNode;
  const showExpandCollapse =
    (!isSuggestion && !isVersion) || isSuggestionWithChildren;
  const { hasChildren } = row;

  const contentClass = isSuggestion ? "content-suggestion" : "";

  if (row.action === "toggle-past-entries") {
    // Footer-row dress: gutter mark, marker, node-size text — laid out by
    // the ordinary row grid so it aligns by construction. The ellipsis is
    // the honest glyph: content elided here.
    return (
      <NodeCard className={cls} cardBodyClassName={clsBody}>
        <div className="indicator-gutter">
          <span
            className="action-row-indicator"
            title="Hidden entries"
            aria-hidden="true"
          >
            …
          </span>
        </div>
        {levels > 0 && <Indent levels={levels} colorLevels={searchDepth} />}
        <span
          className="node-marker"
          aria-hidden="true"
          data-testid="node-marker"
        />
        <div className="w-100 node-content-wrapper">
          <PastDatesActionRow />
        </div>
      </NodeCard>
    );
  }

  return (
    <EditorTextProvider>
      <NodeCard
        className={cls}
        cardBodyClassName={clsBody}
        style={cardStyle}
        data-suggestion={isSuggestion ? "true" : undefined}
        data-virtual-type={virtualType || (isVersion ? "version" : undefined)}
        data-other-user={isOtherUser ? "true" : undefined}
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
          (isSuggestion && !showExpandCollapse)) && (
          <span
            className="node-marker"
            aria-hidden="true"
            data-testid="node-marker"
          />
        )}
        <div className={`w-100 node-content-wrapper ${contentClass}`}>
          <span className={textClassName} style={textStyle}>
            {calendarType && (
              <span
                className="calendar-type-indicator"
                title={calendarType}
                aria-hidden="true"
              >
                {calendarType === "Calendar" ? "🗓︎" : "📅︎"}
              </span>
            )}
            <InteractiveNodeContent rows={rows} />
          </span>
        </div>
        <RightMenu />
      </NodeCard>
    </EditorTextProvider>
  );
}

export const NOTE_TYPE = "note";
