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
  viewKeyForIdentity,
  viewPathToString,
  useRow,
  rowContentKey,
  rowID,
  rowNode,
  rowSourceId,
  rowSpans,
  updateRowView,
  getPreviousSiblingFromRows,
  getVisibleParentRow,
} from "../rowModel";
import { isCanonicalId } from "../core/entityRecognition";
import { planBatchIndent, planBatchOutdent } from "./batchOperations";
import {
  getNode,
  isEmptyNodeID,
  computeEmptyNodeMetadata,
} from "../core/connections";
import { isFileLinkHref, spansText } from "../core/nodeSpans";
import { classifyLinkHref, externalLinkUrl } from "../core/linkPath";
import {
  calendarEntryTarget,
  calendarFeedTargetUrl,
  calendarFeedUrl,
  calendarFeedUrlFromSpans,
  displayTextOf,
  hiddenPastEntryCount,
  isCalendarEntryId,
} from "../core/ical";
import { useCalendarFeeds } from "../CalendarFeedContext";
import { resolveDocumentTarget } from "../core/Document";
import { inlineLinkToHref, isDeadLinkTarget } from "./linkOperations";
import { IncomingPart, ReferenceDisplay } from "./referenceDisplay";
import { MiniEditor, ReciprocalLink, preventEditorBlur } from "./AddNode";
import { EditorTextProvider } from "./EditorTextContext";
import { linkStyleForHref } from "./editorDom";
import { useOnToggleExpanded } from "./SelectNodes";
import { useApis } from "../Apis";
import { useData } from "../DataContext";
import { composedLine } from "../core/composition";
import { getWorkspaceNode } from "../core/knowledge";
import {
  Plan,
  applyGesture,
  usePlanner,
  planSetEmptyNodePosition,
  planSaveVirtualNode,
  planPasteAtEmptyRow,
  planExpandRow,
  planUpdateViews,
  planRemoveEmptyNodePosition,
  planSetRowFocusIntent,
  ParsedLine,
  rowEditing,
} from "../planner";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeCard } from "../commons/Ui";
import { usePaneIndex, useNavigatePane } from "../SplitPanesContext";
import { RightMenu } from "./RightMenu";
import { useItemStyle } from "./useItemStyle";
import {
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
} from "../core/graphLookup";
import { findReciprocalLinkItem } from "../buildReferenceRow";

export { getNodesInTree } from "../treeTraversal";

function getLevels(viewPath: ViewPath): number {
  return viewPath.length - 1;
}

function ExpandCollapseToggle(): JSX.Element | null {
  const row = useRow();
  const rawDisplayText = useDisplayText();
  const displayText = displayTextOf(rawDisplayText);
  const onToggleExpanded = useOnToggleExpanded();
  const isExpanded = useIsExpanded();
  const isEmptyNode = isEmptyNodeID(rowID(row));
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

function PastDatesActionRow(): JSX.Element {
  const data = useData();
  const row = useRow();
  if (row.rowType !== "action") {
    throw new Error("Past dates action requires an action row");
  }
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
        updateRowView(data.views, row, {
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
    rowNode(row),
    reference.sourceId,
    reference.targetLabel || reference.text
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
    return lookupNode(graph, href.slice(1), sourceId);
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

function occurrenceLinkIsDead(row: Row, directlyDead: boolean): boolean {
  if (row.rowType !== "occurrence") {
    return directlyDead;
  }
  const { occurrence } = row;
  if (
    occurrence.kind === "speaking" &&
    occurrence.flags.includes("orphan-source")
  ) {
    return false;
  }
  const terminal = occurrence.chain[occurrence.chain.length - 1];
  return (
    directlyDead ||
    ((occurrence.kind === "placement" || occurrence.kind === "speaking") &&
      terminal !== undefined &&
      !isCanonicalId(terminal) &&
      occurrence.flags.some(
        (flag) => flag === "dangling" || flag === "orphan-source"
      ))
  );
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
  const occurrence = row.rowType === "occurrence" ? row.occurrence : undefined;
  const displayedText =
    occurrence?.target !== undefined && span.href === `#${occurrence.target}`
      ? occurrence.text
      : span.text;
  const calendarContent =
    !isSearchResult &&
    (calendarFeedUrl(node) !== undefined ||
      (occurrence?.target !== undefined &&
        isCalendarEntryId(occurrence.target)));
  const externalUrl = calendarContent ? undefined : externalLinkUrl(span.href);
  const dead = occurrenceLinkIsDead(
    row,
    isDeadLinkTarget(data, span.href, node, sourceId)
  );
  const internalHref =
    dead || calendarContent
      ? undefined
      : inlineLinkToHref(data, span.href, node, sourceId, span.text);
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
          {displayedText}
        </span>
        {reciprocal && (
          <IncomingPart
            relevance={reciprocal.relevance}
            argument={reciprocal.argument}
            ariaHidden
          />
        )}
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
            dead ? `${displayedText}. Target no longer exists` : undefined
          }
        >
          {displayedText}
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
        aria-label={`Navigate to ${displayedText}`}
      >
        {displayedText}
      </a>
      {reciprocal && (
        <IncomingPart
          relevance={reciprocal.relevance}
          argument={reciprocal.argument}
          ariaHidden
        />
      )}
    </>
  );
}

function InlineSpans({
  spans,
  node,
  sourceId,
}: {
  spans: InlineSpan[];
  node: GraphNode;
  sourceId: SourceId;
}): JSX.Element {
  const data = useData();
  const reciprocals = reciprocalLinks(data, node, sourceId);
  return (
    <span className="break-word">
      {spans.map((span, index) => {
        const key = `${index}-${span.kind}-${span.text}`;
        if (span.kind === "link") {
          if (span.struck === true) {
            return null;
          }
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

function hasInlineLinks(spans: InlineSpan[]): boolean {
  return spans.some((span) => span.kind === "link");
}

function NodeContent(): JSX.Element {
  const row = useRow();
  const data = useData();
  const { reference } = row;
  const displayText = useDisplayText();

  if (row.rowType === "occurrence") {
    const line = composedLine(row.occurrence);
    const reciprocal = reciprocalLinks(data, line.node, line.ref.sourceId)[0];
    if (!hasInlineLinks(row.occurrence.spans) && reference) {
      return <ReferenceContent reference={reference} />;
    }
    return (
      <>
        {hasInlineLinks(row.occurrence.spans) ? (
          <InlineSpans
            spans={row.occurrence.spans}
            node={line.node}
            sourceId={line.ref.sourceId}
          />
        ) : (
          <span className="break-word">{displayTextOf(displayText)}</span>
        )}
        {reciprocal && (
          <IncomingPart
            relevance={reciprocal.relevance}
            argument={reciprocal.argument}
            ariaHidden
          />
        )}
      </>
    );
  }

  if (row.virtualType === "search" && hasInlineLinks(row.node.spans)) {
    return (
      <span
        data-testid="reference-row"
        style={{ fontStyle: "italic", textDecoration: "none" }}
      >
        <InlineSpans
          spans={row.node.spans}
          node={row.node}
          sourceId={row.sourceId}
        />
      </span>
    );
  }

  if (reference) {
    return <ReferenceContent reference={reference} />;
  }

  if (hasInlineLinks(row.node.spans)) {
    return (
      <InlineSpans
        spans={row.node.spans}
        node={row.node}
        sourceId={row.sourceId}
      />
    );
  }

  return <span className="break-word">{displayTextOf(displayText)}</span>;
}

function EditableContent({ rows }: { rows: List<Row> }): JSX.Element {
  const row = useRow();
  const { viewKey, viewPath } = row;
  const paneIndex = usePaneIndex();
  const data = useData();
  const { fetchEntityMetadata } = useApis();
  const { textStyle } = useItemStyle();
  const { createPlan, executePlan } = usePlanner();
  const navigatePane = useNavigatePane();
  const { feeds: calendarFeeds } = useCalendarFeeds();
  const currentNode = rowNode(row);
  const prevSibling = getPreviousSiblingFromRows(rows, row);
  const visibleParent = getVisibleParentRow(rows, row);
  const parentNode = (() => {
    if (row.rowType !== "occurrence") {
      return row.parentNode;
    }
    return visibleParent === undefined ? undefined : rowNode(visibleParent);
  })();
  const parentPath = row.parentViewPath;
  const viewIsExpanded = useIsExpanded();
  const nodeIsRoot = useIsRoot();
  const nodeIndex = useNodeIndex();
  const isEmptyNode = isEmptyNodeID(rowID(row));
  const nodeIsExpanded = viewIsExpanded && row.hasChildren;

  const emptyNodeMetadata = computeEmptyNodeMetadata(
    data.publishEventsStatus.temporaryEvents
  );
  const emptyData = visibleParent
    ? emptyNodeMetadata.get(rowContentKey(visibleParent))
    : undefined;
  const isRootEmptyNode = isEmptyNode && !parentPath;
  const shouldAutoFocus =
    isEmptyNode && (isRootEmptyNode || emptyData?.paneIndex === paneIndex);
  const escapeFocusPendingRef = React.useRef(false);

  const planWithRowFocusIntent = (
    plan: Plan,
    targetViewPath: ViewPath,
    nodeId: ID
  ): Plan =>
    planSetRowFocusIntent(plan, {
      paneIndex,
      viewKey:
        row.rowType === "occurrence"
          ? row.viewKey
          : viewKeyForIdentity(
              paneIndex,
              targetViewPath[1] ?? nodeId,
              `source:${nodeRefKey({ sourceId: LOCAL, id: nodeId })}`
            ),
      nodeId,
    });

  const occurrence = row.rowType === "occurrence" ? row.occurrence : undefined;
  const editing = occurrence ? rowEditing(occurrence) : undefined;
  const feedUrl = occurrence
    ? calendarFeedTargetUrl(occurrence.target) ??
      calendarFeedUrlFromSpans(occurrence.spans)
    : calendarFeedUrl(currentNode);
  const calendarContent = editing?.calendar ?? feedUrl !== undefined;
  const rewordEditing = !calendarContent && editing?.reword === true;
  const editorSpans = editing?.spans ?? rowSpans(row);
  const linkLine = occurrence ? composedLine(occurrence) : undefined;
  const linkNode = linkLine?.node ?? rowNode(row);
  const linkSourceId = linkLine?.ref.sourceId ?? rowSourceId(row);
  const reciprocals = reciprocalLinks(data, linkNode, linkSourceId);
  const deadLinkIndexes = editorSpans.flatMap((span, index) =>
    span.kind === "link" &&
    occurrenceLinkIsDead(
      row,
      isDeadLinkTarget(data, span.href, linkNode, linkSourceId)
    )
      ? [index]
      : []
  );
  const externalLinkIndexes = calendarContent
    ? []
    : editorSpans.flatMap((span, index) =>
        span.kind === "link" && externalLinkUrl(span.href) ? [index] : []
      );
  const calendarLinkIndexes = calendarContent ? [0] : [];
  const prepareEmptyInside = (
    plan: Plan,
    parentRow: Extract<Row, { rowType: "occurrence" }>,
    insertIndex: number
  ): Plan =>
    planSetEmptyNodePosition(
      planExpandRow(plan, parentRow),
      rowNode(parentRow),
      parentRow.view,
      parentRow.viewPath,
      parentRow.viewKey,
      rowContentKey(parentRow),
      paneIndex,
      insertIndex
    );

  const saveRow = (
    plan: Plan,
    spans: InlineSpan[]
  ): { plan: Plan; viewPath: ViewPath; node: GraphNode } => {
    if (row.rowType === "occurrence") {
      return {
        plan: applyGesture(plan, row.composition, {
          kind: "reword",
          row: row.occurrence.key,
          spans,
        }),
        viewPath,
        node: currentNode,
      };
    }
    return row.rowType === "empty"
      ? planSaveVirtualNode(plan, spans, row, paneIndex, undefined, undefined)
      : { plan, viewPath, node: currentNode };
  };

  const handleSave = async (
    spans: InlineSpan[],
    submitted?: boolean
  ): Promise<void> => {
    const nextSpans = spans;
    if (rewordEditing && occurrence && row.rowType === "occurrence") {
      const unchanged = spansText(nextSpans).trim() === occurrence.text.trim();
      if (!unchanged) {
        await executePlan(
          applyGesture(createPlan(), row.composition, {
            kind: "reword",
            row: occurrence.key,
            spans: nextSpans,
          })
        );
      } else if (
        submitted &&
        occurrence.origin.writeRoot !== undefined &&
        !getWorkspaceNode(createPlan().knowledgeDBs, occurrence.id)
      ) {
        await executePlan(prepareEmptyInside(createPlan(), row, 0));
      }
      return;
    }
    const initialPlan = createPlan();
    const {
      plan: basePlan,
      viewPath: updatedViewPath,
      node: savedNode,
    } = saveRow(initialPlan, nextSpans);
    const planWithEscFocus = escapeFocusPendingRef.current
      ? planWithRowFocusIntent(basePlan, updatedViewPath, savedNode.id)
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
          parentViewKey:
            row.rowType === "occurrence"
              ? row.viewKey
              : viewKeyForIdentity(
                  paneIndex,
                  updatedViewPath[1] ?? savedNode.id,
                  `source:${nodeRefKey({ sourceId: LOCAL, id: savedNode.id })}`
                ),
          parentKey:
            row.rowType === "occurrence"
              ? rowContentKey(row)
              : `${LOCAL}:${savedNode.id}`,
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
      const insertAt = (() => {
        if (
          row.rowType === "occurrence" &&
          parentRow.rowType === "occurrence"
        ) {
          const index = parentRow.occurrence.children.findIndex(
            (child) => child.key === row.occurrence.key
          );
          return index < 0 ? 0 : index + 1;
        }
        return nodeIndex === undefined ? 0 : nodeIndex + 1;
      })();
      return {
        parentNode,
        parentView: parentRow.view,
        parentViewPath: parentRow.viewPath,
        parentViewKey: parentRow.viewKey,
        parentKey: rowContentKey(parentRow),
        insertAt,
      };
    })();

    if (!nextPosition) {
      await executePlan(planWithEscFocus);
      return;
    }

    const plan = planSetEmptyNodePosition(
      basePlan,
      nextPosition.parentNode,
      nextPosition.parentView,
      nextPosition.parentViewPath,
      nextPosition.parentViewKey,
      nextPosition.parentKey,
      paneIndex,
      nextPosition.insertAt
    );
    await executePlan(plan);
  };

  const handleTab = (spans: InlineSpan[]): void => {
    const basePlan = createPlan();
    const trimmedText = spansText(spans).trim();

    if (isEmptyNode) {
      if (prevSibling?.rowType !== "occurrence" || !parentPath) return;
      const planWithoutEmpty = row.parentKey
        ? planRemoveEmptyNodePosition(basePlan, row.parentKey)
        : basePlan;
      if (trimmedText) {
        executePlan(
          applyGesture(
            planExpandRow(planWithoutEmpty, prevSibling),
            prevSibling.composition,
            {
              kind: "place",
              parent: prevSibling.occurrence.key,
              targets: [
                {
                  kind: "spans",
                  spans,
                  relevance: undefined,
                  argument: undefined,
                },
              ],
              after: prevSibling.occurrence.children.at(-1)?.key,
            }
          )
        );
        return;
      }
      executePlan(prepareEmptyInside(planWithoutEmpty, prevSibling, 0));
      return;
    }

    const result = planBatchIndent(basePlan, [row], rows, {
      spans,
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
      if (!parentRow) return;
      const grandParentRow = getVisibleParentRow(rows, parentRow);
      if (
        parentRow.rowType !== "occurrence" ||
        grandParentRow?.rowType !== "occurrence"
      )
        return;
      const parentNodeIndex = grandParentRow.occurrence.children.findIndex(
        (child) => child.key === parentRow.occurrence.key
      );
      if (parentNodeIndex < 0) return;

      const planWithoutEmpty = row.parentKey
        ? planRemoveEmptyNodePosition(basePlan, row.parentKey)
        : basePlan;

      if (!trimmedText) {
        executePlan(
          prepareEmptyInside(
            planWithoutEmpty,
            grandParentRow,
            parentNodeIndex + 1
          )
        );
        return;
      }

      executePlan(
        applyGesture(planWithoutEmpty, grandParentRow.composition, {
          kind: "place",
          parent: grandParentRow.occurrence.key,
          targets: [
            {
              kind: "spans",
              spans,
              relevance: undefined,
              argument: undefined,
            },
          ],
          after: grandParentRow.occurrence.children[parentNodeIndex]?.key,
        })
      );
      return;
    }

    const result = planBatchOutdent(basePlan, [row], rows, {
      spans,
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
    if (row.rowType === "empty") {
      executePlan(
        planPasteAtEmptyRow(createPlan(), row, currentSpans, children)
      );
      return;
    }
    const { plan: basePlan } = saveRow(createPlan(), currentSpans);
    const placementParent =
      !parentNode || !parentPath ? row : getVisibleParentRow(rows, row);
    if (
      row.rowType !== "occurrence" ||
      placementParent?.rowType !== "occurrence"
    ) {
      return;
    }
    executePlan(
      applyGesture(basePlan, placementParent.composition, {
        kind: "place",
        parent: placementParent.occurrence.key,
        targets: [{ kind: "outline", lines: children }],
        after:
          placementParent.viewKey === row.viewKey
            ? undefined
            : row.occurrence.key,
      })
    );
  };

  const handleDelete = (): void => {
    if (!parentNode || row.rowType !== "occurrence") {
      return;
    }
    executePlan(
      applyGesture(createPlan(), row.composition, {
        kind: "dismiss",
        row: row.occurrence.key,
      })
    );
  };

  const handleEscapeRequest = (): void => {
    // eslint-disable-next-line functional/immutable-data
    escapeFocusPendingRef.current = true;
  };

  const handleClose = (): void => {
    if (!isEmptyNode || !parentPath) return;
    const plan = createPlan();
    if (row.parentKey) {
      executePlan(planRemoveEmptyNodePosition(plan, row.parentKey));
    }
  };

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
    const fallbackLabel = spans.find(
      (span) => span.kind === "link" && span.href === href
    )?.text;
    const targetHref = inlineLinkToHref(
      { ...data, calendarFeeds },
      href,
      rowNode(row),
      rowSourceId(row),
      fallbackLabel
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
        entityPicker={{ fetchEntityMetadata }}
      />
      {rewordEditing &&
        !editorSpans.some((span) => span.kind === "link") &&
        reciprocals[0] !== undefined && (
          <IncomingPart
            relevance={reciprocals[0].relevance}
            argument={reciprocals[0].argument}
            ariaHidden
          />
        )}
    </>
  );
}

function InteractiveNodeContent({ rows }: { rows: List<Row> }): JSX.Element {
  const row = useRow();
  const { virtualType } = row;
  const isLoading = useNodeIsLoading();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isEmptyNode = isEmptyNodeID(rowID(row));
  const isReadonly =
    isInSearchView ||
    isViewingOtherUserContent ||
    virtualType !== undefined ||
    (rowSourceId(row) !== LOCAL && row.rowType !== "occurrence");

  if (isLoading) {
    return <LoadingNode />;
  }

  if (isEmptyNode) {
    return isReadonly ? <></> : <EditableContent rows={rows} />;
  }

  if (!isReadonly) {
    return <EditableContent rows={rows} />;
  }

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

export function Node({
  className,
  cardBodyClassName,
  rows,
}: {
  className?: string;
  cardBodyClassName?: string;
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
  const currentNode = rowNode(row);
  const calendarType = (() => {
    if (virtualType !== undefined) return undefined;
    if (calendarFeedUrl(currentNode) !== undefined) return "Calendar";
    const target =
      row.rowType === "occurrence" ? row.occurrence.target : undefined;
    return isCalendarEntryId(target ?? currentNode.id) ? "Date" : undefined;
  })();
  const isViewingOtherUser = useIsViewingOtherUserContent();
  const node = row.reference;
  const isOtherUser = (node && node.sourceId !== LOCAL) || isViewingOtherUser;

  const { hasChildren } = row;

  const contentClass = "";

  if (row.action) {
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
        <div className="right-menu">
          <div className="relevance-slot" />
          <div className="evidence-slot" />
          <div className="action-slot" />
        </div>
      </NodeCard>
    );
  }

  return (
    <NodeCard
      className={cls}
      cardBodyClassName={clsBody}
      style={cardStyle}
      data-virtual-type={virtualType}
      data-other-user={isOtherUser ? "true" : undefined}
    >
      <div className="indicator-gutter">
        {virtualType === "incoming" && <IncomingRefGutterIndicator />}
        {relevance === "relevant" && (
          <span
            className="relevant-indicator"
            title="Relevant"
            aria-hidden="true"
          >
            !
          </span>
        )}
        {relevance === "maybe_relevant" && (
          <span
            className="maybe-relevant-indicator"
            title="Maybe Relevant"
            aria-hidden="true"
          >
            ?
          </span>
        )}
        {relevance === "little_relevant" && (
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
      {hasChildren && <ExpandCollapseToggle />}
      {!hasChildren && (
        <span
          className="node-marker"
          aria-hidden="true"
          data-testid="node-marker"
        />
      )}
      <EditorTextProvider>
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
      </EditorTextProvider>
    </NodeCard>
  );
}

export const NOTE_TYPE = "note";
