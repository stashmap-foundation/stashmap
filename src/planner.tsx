/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, OrderedSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  newTimestamp,
  msTag,
} from "./nostr";
import { useData } from "./DataContext";
import { useExecutor } from "./ExecutorContext";
import {
  Document as KnowstrDocument,
  documentKeyOf,
  withDocumentRealWorldEntities,
} from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import { buildDocumentEvent } from "./nodesDocumentEvent";
import { newStorageKey } from "./storageEncryption";
import {
  EMPTY_NODE_ID,
  isEmptyNodeID,
  computeEmptyNodeMetadata,
  createRefTarget,
  getNode,
  isSearchId,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planUpsertNodes,
  withDocumentRoot,
} from "./core/plan";
import {
  newGraphNode,
  ViewPath,
  updateView,
  getParentView,
  addNodeToPathWithNodes,
  bulkUpdateViewPathsAfterAddNode,
  copyViewsWithNewPrefix,
  viewPathToString,
} from "./rowModel";
import {
  nodeText,
  placementTarget,
  plainSpans,
  spansText,
  spansToMarkdown,
} from "./core/nodeSpans";
import { calendarEntryEditedSpans } from "./core/ical";
import { classifyLinkHref } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";
import { entityIdForText } from "./core/entityRecognition";
import { getWorkspaceNode } from "./core/knowledge";
import { planRemoveNodeItemById } from "./dataPlanner";
import { Gesture, ComposedRow } from "./core/composition";
import {
  MultiSelectionState,
  clearSelection,
  shiftSelect,
  toggleSelect,
} from "./core/selection";

export type { AddToParentTarget, GraphPlan } from "./core/plan";
export {
  createGraphPlan,
  planAddTargetsToNode,
  planAddTopTargetsToDocument,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./core/plan";

type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    paneUpdate: boolean;
  };

export type Plan = WorkspacePlan;

function localPlacement(
  plan: Plan,
  parentID: ID,
  target: ID
): GraphNode | undefined {
  const parent = getWorkspaceNode(plan.knowledgeDBs, parentID);
  return parent?.children
    .map((id) => getWorkspaceNode(plan.knowledgeDBs, id))
    .find((node) => placementTarget(node) === target);
}

function ensurePlacement(
  plan: Plan,
  parentID: ID,
  target: ID,
  text: string,
  relevance: Relevance,
  argument: Argument
): [Plan, GraphNode | undefined] {
  const existing = localPlacement(plan, parentID, target);
  if (existing) {
    return [plan, existing];
  }
  const [next, ids] = planAddTargetsToNode(
    plan,
    parentID,
    createRefTarget(target, text),
    undefined,
    relevance,
    argument
  );
  return [next, getWorkspaceNode(next.knowledgeDBs, ids[0])];
}

function localParentFor(
  plan: Plan,
  row: ComposedRow
): [Plan, GraphNode | undefined] {
  const direct =
    row.ref.sourceId === LOCAL
      ? getWorkspaceNode(plan.knowledgeDBs, row.id)
      : undefined;
  if (row.reader && direct) {
    return [plan, direct];
  }
  const parent = getWorkspaceNode(plan.knowledgeDBs, row.writeParent);
  return parent
    ? ensurePlacement(
        plan,
        parent.id,
        row.target ?? row.id,
        row.text,
        undefined,
        undefined
      )
    : [plan, undefined];
}

function nextUpdated(node: GraphNode): number {
  return Math.max(Date.now(), node.updated + 1);
}

function moveLocalNode(
  plan: Plan,
  node: GraphNode,
  parent: GraphNode,
  afterID: ID | undefined
): Plan {
  const oldParent = node.parent
    ? getWorkspaceNode(plan.knowledgeDBs, node.parent)
    : undefined;
  const withoutOld = oldParent
    ? planUpsertNodes(plan, {
        ...oldParent,
        children: oldParent.children.filter((id) => id !== node.id),
        updated: nextUpdated(oldParent),
      })
    : plan;
  const currentParent = getWorkspaceNode(withoutOld.knowledgeDBs, parent.id);
  if (!currentParent) {
    return plan;
  }
  const siblings = currentParent.children.filter((id) => id !== node.id);
  const afterIndex = afterID === undefined ? -1 : siblings.indexOf(afterID);
  const index = afterID === undefined ? 0 : afterIndex + 1;
  const withParent = planUpsertNodes(withoutOld, {
    ...currentParent,
    children:
      afterID !== undefined && afterIndex < 0
        ? siblings.push(node.id)
        : siblings.insert(index, node.id),
    updated: nextUpdated(currentParent),
  });
  return planUpsertNodes(withParent, {
    ...node,
    parent: currentParent.id,
    root: currentParent.root,
    updated: nextUpdated(node),
  });
}

function clearPosition(
  attrs: Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs ?? {}).filter(
      ([key]) => key !== "front" && key !== "after"
    )
  );
}

function migrateViewPath(
  plan: Plan,
  source: ViewPath,
  destination: ViewPath
): Plan {
  return planUpdateViews(
    plan,
    copyViewsWithNewPrefix(
      plan.views,
      viewPathToString(source),
      viewPathToString(destination)
    )
  );
}

function positionRows(
  plan: Plan,
  parent: ComposedRow,
  movedRows: ComposedRow[],
  moved: ReadonlyMap<ID, ID>,
  after: ComposedRow | undefined
): Plan {
  const scope = getWorkspaceNode(plan.knowledgeDBs, parent.scope);
  if (!scope || placementTarget(scope) === undefined) {
    return [...moved.values()].reduce((current, id) => {
      const node = getWorkspaceNode(current.knowledgeDBs, id);
      return node
        ? planUpsertNodes(current, {
            ...node,
            extraAttrs: clearPosition(node.extraAttrs),
            updated: nextUpdated(node),
          })
        : current;
    }, plan);
  }
  const stationary = parent.children.filter((row) => !moved.has(row.id));
  const anchorIndex =
    after === undefined
      ? -1
      : stationary.findIndex((row) => row.id === after.id);
  const desired = [
    ...stationary.slice(0, anchorIndex + 1),
    ...movedRows,
    ...stationary.slice(anchorIndex + 1),
  ];
  const localIDFor = (row: ComposedRow): ID | undefined =>
    moved.get(row.id) ?? (row.reader ? row.id : undefined);
  const signatureAt = (index: number): string => {
    const predecessor = desired[index - 1];
    return predecessor
      ? `after:${predecessor.target ?? predecessor.id}`
      : "front";
  };
  const currentSignature = (node: GraphNode): string | undefined =>
    node.extraAttrs?.front === "true"
      ? "front"
      : node.extraAttrs?.after === undefined
      ? undefined
      : `after:${node.extraAttrs.after}`;
  const movedSeats = new globalThis.Set(
    movedRows.flatMap((row) => [row.id, ...(row.target ? [row.target] : [])])
  );
  const affected = new globalThis.Set<ID>(moved.values());
  desired.forEach((row) => {
    const localID = localIDFor(row);
    const node =
      localID === undefined
        ? undefined
        : getWorkspaceNode(plan.knowledgeDBs, localID);
    if (
      localID !== undefined &&
      node?.extraAttrs?.after &&
      movedSeats.has(node.extraAttrs.after)
    ) {
      affected.add(localID);
    }
  });
  const expandAffected = (): void => {
    const occupied = new globalThis.Set(
      desired.flatMap((row, index) => {
        const localID = localIDFor(row);
        return localID !== undefined && affected.has(localID)
          ? [signatureAt(index)]
          : [];
      })
    );
    const displaced = desired.flatMap((row) => {
      const localID = localIDFor(row);
      const node =
        localID === undefined
          ? undefined
          : getWorkspaceNode(plan.knowledgeDBs, localID);
      const signature = node ? currentSignature(node) : undefined;
      return localID !== undefined &&
        !affected.has(localID) &&
        signature !== undefined &&
        occupied.has(signature)
        ? [localID]
        : [];
    });
    displaced.forEach((id) => affected.add(id));
    if (displaced.length > 0) {
      expandAffected();
    }
  };
  expandAffected();
  return desired.reduce((current, row, index) => {
    const localID = localIDFor(row);
    if (localID === undefined || !affected.has(localID)) {
      return current;
    }
    const node = getWorkspaceNode(current.knowledgeDBs, localID);
    if (!node) {
      return current;
    }
    const predecessor = desired[index - 1];
    const extraAttrs = predecessor
      ? {
          ...clearPosition(node.extraAttrs),
          after: predecessor.target ?? predecessor.id,
        }
      : { ...clearPosition(node.extraAttrs), front: "true" };
    return currentSignature(node) === signatureAt(index)
      ? current
      : planUpsertNodes(current, {
          ...node,
          extraAttrs,
          updated: nextUpdated(node),
        });
  }, plan);
}

function rewordingSpans(row: ComposedRow, spans: InlineSpan[]): InlineSpan[] {
  const spoken = spans.map(
    (span): InlineSpan =>
      span.kind === "link" ? { kind: "text", text: span.text } : span
  );
  const last = spoken[spoken.length - 1];
  const words: InlineSpan[] =
    last?.kind === "text"
      ? [
          ...spoken.slice(0, -1),
          { kind: "text", text: `${last.text.trimEnd()} ` },
        ]
      : [...spoken, { kind: "text", text: " " }];
  const existingBonds =
    row.reader && row.kind === "speaking"
      ? row.node.spans.filter(
          (span) => span.kind === "link" && span.struck === true
        )
      : [];
  const bonds: InlineSpan[] =
    existingBonds.length > 0
      ? existingBonds
      : [
          {
            kind: "link",
            href: `#${row.target ?? row.id}`,
            text: row.text.trim(),
            struck: true,
          },
        ];
  return [...words, ...bonds];
}

function isRewording(row: ComposedRow, spans: InlineSpan[]): boolean {
  return (
    spansText(spans).trim() !== "" &&
    (!row.reader || row.kind === "placement" || row.kind === "speaking") &&
    spansText(spans).trim() !== row.text.trim()
  );
}

function evidenceParentFor(
  plan: Plan,
  gesture: Extract<Gesture, { kind: "judge" }>
): GraphNode | undefined {
  return gesture.argument === undefined ||
    gesture.row.sourceParent === undefined
    ? undefined
    : getNode(
        plan.knowledgeDBs,
        gesture.row.sourceParent.id,
        gesture.row.sourceParent.sourceId
      );
}

function containingScope(row: ComposedRow): ID {
  return row.scope === row.id ? row.writeParent : row.scope;
}

function judge(plan: Plan, gesture: Extract<Gesture, { kind: "judge" }>): Plan {
  const existing =
    gesture.row.reader && gesture.row.ref.sourceId === LOCAL
      ? getWorkspaceNode(plan.knowledgeDBs, gesture.row.id)
      : undefined;
  const rewording = isRewording(gesture.row, gesture.spans);
  const spans = rewording
    ? rewordingSpans(gesture.row, gesture.spans)
    : gesture.spans;
  if (existing) {
    const stamp = (current: Plan, node: GraphNode): Plan =>
      planUpsertNodes(current, {
        ...node,
        spans:
          (gesture.row.kind === "placement" ||
            gesture.row.kind === "speaking") &&
          !rewording
            ? node.spans
            : spansText(spans).trim() === ""
            ? node.spans
            : spans,
        relevance: gesture.relevance,
        argument: gesture.argument,
        updated: nextUpdated(node),
      });
    const evidenceParent = evidenceParentFor(plan, gesture);
    const scope = getWorkspaceNode(
      plan.knowledgeDBs,
      containingScope(gesture.row)
    );
    const writtenParent =
      existing.parent !== undefined
        ? getWorkspaceNode(plan.knowledgeDBs, existing.parent)
        : undefined;
    const boundAlready =
      evidenceParent === undefined ||
      scope === undefined ||
      placementTarget(scope) === evidenceParent.id ||
      placementTarget(writtenParent) === evidenceParent.id;
    if (boundAlready) {
      return stamp(plan, existing);
    }
    const withoutFlat =
      existing.parent !== undefined
        ? planRemoveNodeItemById(plan, existing.parent, existing.id)
        : plan;
    const [withParent, parentLine] = ensurePlacement(
      withoutFlat,
      scope.id,
      evidenceParent.id,
      nodeText(evidenceParent),
      undefined,
      undefined
    );
    if (!parentLine) {
      return stamp(plan, existing);
    }
    const [rebound, reboundRow] = ensurePlacement(
      withParent,
      parentLine.id,
      gesture.row.target ?? gesture.row.id,
      gesture.row.text,
      gesture.relevance,
      gesture.argument
    );
    return reboundRow ? rebound : stamp(plan, existing);
  }
  const evidenceParent = evidenceParentFor(plan, gesture);
  const scope = getWorkspaceNode(
    plan.knowledgeDBs,
    containingScope(gesture.row)
  );
  if (!scope) {
    return plan;
  }
  const [withParent, parent] = evidenceParent
    ? placementTarget(scope) === evidenceParent.id
      ? [plan, scope]
      : ensurePlacement(
          plan,
          scope.id,
          evidenceParent.id,
          nodeText(evidenceParent),
          undefined,
          undefined
        )
    : [plan, scope];
  if (!parent) {
    return plan;
  }
  const [withRow, row] = ensurePlacement(
    withParent,
    parent.id,
    gesture.row.target ?? gesture.row.id,
    gesture.row.text,
    gesture.relevance,
    gesture.argument
  );
  return row && rewording
    ? planUpdateNodeSpans(withRow, row.id, spans)
    : withRow;
}

function repairSourceDependents(
  plan: Plan,
  rows: Extract<Gesture, { kind: "move" }>["rows"]
): Plan {
  const moved = new globalThis.Set(rows.map((entry) => entry.row));
  const repairs = rows
    .flatMap((entry) => {
      const seats = [
        entry.row.id,
        ...(entry.row.target ? [entry.row.target] : []),
      ];
      return (entry.sourceParent?.children ?? [])
        .filter(
          (candidate) =>
            !moved.has(candidate) &&
            !candidate.flags.includes("ambiguous-anchor") &&
            !candidate.flags.includes("lapsed") &&
            candidate.node.extraAttrs?.after !== undefined &&
            seats.includes(candidate.node.extraAttrs.after)
        )
        .map((dependent) => ({
          dependent,
          predecessor: entry.predecessor,
        }));
    })
    .filter(
      (repair, index, all) =>
        all.findIndex(
          (candidate) => candidate.dependent === repair.dependent
        ) === index
    );
  return repairs.reduce((current, repair) => {
    const node =
      repair.dependent.reader && repair.dependent.ref.sourceId === LOCAL
        ? getWorkspaceNode(current.knowledgeDBs, repair.dependent.id)
        : undefined;
    if (!node) {
      return current;
    }
    const position: Record<string, string> = repair.predecessor
      ? { after: repair.predecessor.target ?? repair.predecessor.id }
      : { front: "true" };
    return planUpsertNodes(current, {
      ...node,
      extraAttrs: { ...clearPosition(node.extraAttrs), ...position },
      updated: nextUpdated(node),
    });
  }, plan);
}

function move(plan: Plan, gesture: Extract<Gesture, { kind: "move" }>): Plan {
  const repaired = repairSourceDependents(plan, gesture.rows);
  const [withParent, parent] = localParentFor(repaired, gesture.parent);
  if (!parent) {
    return plan;
  }
  const materialized = gesture.rows.reduce(
    (current, entry) => {
      const existing =
        entry.row.reader && entry.row.ref.sourceId === LOCAL
          ? getWorkspaceNode(current.plan.knowledgeDBs, entry.row.id)
          : undefined;
      const [withRow, node] = existing
        ? [current.plan, existing]
        : ensurePlacement(
            current.plan,
            parent.id,
            entry.row.target ?? entry.row.id,
            entry.row.text,
            entry.row.reader ? entry.row.node.relevance : undefined,
            entry.row.reader ? entry.row.node.argument : undefined
          );
      if (!node) {
        return current;
      }
      const moved = moveLocalNode(withRow, node, parent, current.afterID);
      const currentParent = getWorkspaceNode(moved.knowledgeDBs, parent.id);
      const index = currentParent?.children.indexOf(node.id) ?? -1;
      const withViews =
        currentParent && index >= 0
          ? migrateViewPath(
              moved,
              entry.path,
              addNodeToPathWithNodes(gesture.parentPath, currentParent, index)
            )
          : moved;
      return {
        plan: withViews,
        ids: new globalThis.Map([...current.ids, [entry.row.id, node.id]]),
        afterID: node.id,
      };
    },
    {
      plan: withParent,
      ids: new globalThis.Map<ID, ID>(),
      afterID: gesture.after?.reader ? gesture.after.id : undefined,
    }
  );
  return positionRows(
    materialized.plan,
    gesture.parent,
    gesture.rows.map((entry) => entry.row),
    materialized.ids,
    gesture.after
  );
}

export function applyGesture(plan: Plan, gesture: Gesture): Plan {
  if (gesture.kind === "judge") {
    return judge(plan, gesture);
  }
  if (gesture.kind === "dismiss") {
    return judge(plan, {
      kind: "judge",
      row: gesture.row,
      path: gesture.path,
      relevance: "not_relevant",
      argument: gesture.row.argument,
      spans: gesture.spans,
    });
  }
  if (gesture.kind === "move") {
    return move(plan, gesture);
  }
  if (gesture.kind === "place") {
    const [withParent, parent] = localParentFor(plan, gesture.parent);
    return parent
      ? ensurePlacement(
          withParent,
          parent.id,
          gesture.row.target ?? gesture.row.id,
          gesture.row.text,
          gesture.row.relevance,
          gesture.row.argument
        )[0]
      : plan;
  }
  const existing =
    gesture.row.reader && gesture.row.ref.sourceId === LOCAL
      ? getWorkspaceNode(plan.knowledgeDBs, gesture.row.id)
      : undefined;
  const scope = getWorkspaceNode(
    plan.knowledgeDBs,
    containingScope(gesture.row)
  );
  if (!scope) {
    return plan;
  }
  const [materialized, node] = existing
    ? [plan, existing]
    : ensurePlacement(
        plan,
        scope.id,
        gesture.row.target ?? gesture.row.id,
        gesture.row.text,
        gesture.row.relevance,
        gesture.row.argument
      );
  if (!node) {
    return plan;
  }
  return planUpdateNodeSpans(
    materialized,
    node.id,
    rewordingSpans(gesture.row, gesture.spans)
  );
}

function soleEmbedLinkHref(spans: InlineSpan[]): string | undefined {
  const span =
    spans.length === 1 && spans[0]?.kind === "link" ? spans[0] : undefined;
  return span &&
    (span.href.startsWith("#") || classifyLinkHref(span.href) === "feed")
    ? span.href
    : undefined;
}

function isStandaloneEmbedLink(spans: InlineSpan[]): boolean {
  return soleEmbedLinkHref(spans) !== undefined;
}

export function planUpdateNodeSpans(
  plan: Plan,
  nodeID: ID,
  spans: InlineSpan[]
): Plan {
  const currentNode = getWorkspaceNode(plan.knowledgeDBs, nodeID);
  if (
    !currentNode ||
    spansToMarkdown(currentNode.spans) === spansToMarkdown(spans)
  ) {
    return plan;
  }
  // The embed attr is written when a sole link is created or retargeted —
  // a first-party gesture. Touching the label of an existing plain block
  // link (the Log's form) never converts it into an embed.
  const nextEmbedHref = soleEmbedLinkHref(spans);
  const stampEmbed =
    nextEmbedHref !== undefined &&
    nextEmbedHref !== soleEmbedLinkHref(currentNode.spans);
  return planUpsertNodes(plan, {
    ...currentNode,
    spans,
    ...(stampEmbed && {
      extraAttrs: { ...currentNode.extraAttrs, embed: "true" },
    }),
    updated: nextUpdated(currentNode),
  });
}

export function planUpdateNodeText(plan: Plan, nodeID: ID, text: string): Plan {
  return planUpdateNodeSpans(plan, nodeID, plainSpans(text));
}

function removeEmptyNodeFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  sourceId: SourceId,
  nodeID: ID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(sourceId);
  if (!myDB) {
    return knowledgeDBs;
  }

  const existingNodeID = nodeID;
  const existingNodes = myDB.nodes.get(existingNodeID);
  if (!existingNodes) {
    return knowledgeDBs;
  }

  const filteredItems = existingNodes.children.filter(
    (itemID) => !isEmptyNodeID(itemID)
  );
  if (filteredItems.size === existingNodes.children.size) {
    return knowledgeDBs;
  }

  const updatedNodes = myDB.nodes.set(existingNodeID, {
    ...existingNodes,
    children: filteredItems,
  });
  return knowledgeDBs.set(sourceId, {
    ...myDB,
    nodes: updatedNodes,
  });
}

export function planUpdateViews(plan: Plan, views: Views): Plan {
  return {
    ...plan,
    views,
  };
}

export function planUpdatePanes(plan: Plan, panes: Pane[]): Plan {
  return {
    ...plan,
    panes,
    paneUpdate: true,
  };
}

export function planSetRowFocusIntent(
  plan: Plan,
  intent: Omit<RowFocusIntent, "requestId">
): Plan {
  const currentMaxRequestId = Math.max(
    0,
    ...plan.temporaryView.rowFocusIntents
      .valueSeq()
      .map((currentIntent) => currentIntent.requestId)
      .toArray()
  );
  const requestId = currentMaxRequestId + 1;
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      rowFocusIntents: plan.temporaryView.rowFocusIntents.set(
        intent.paneIndex,
        {
          ...intent,
          requestId,
        }
      ),
    },
  };
}

function getTemporarySelectionState(plan: Plan): MultiSelectionState {
  return {
    baseSelection: plan.temporaryView.baseSelection,
    shiftSelection: plan.temporaryView.shiftSelection,
    anchor: plan.temporaryView.anchor,
  };
}

export function planSetTemporarySelectionState(
  plan: Plan,
  state: MultiSelectionState
): Plan {
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      baseSelection: state.baseSelection,
      shiftSelection: state.shiftSelection,
      anchor: state.anchor,
    },
  };
}

export function planToggleTemporarySelection(
  plan: Plan,
  viewKey: string
): Plan {
  return planSetTemporarySelectionState(
    plan,
    toggleSelect(getTemporarySelectionState(plan), viewKey)
  );
}

export function planShiftTemporarySelection(
  plan: Plan,
  orderedKeys: string[],
  targetViewKey: string,
  fallbackAnchor?: string
): Plan {
  const current = getTemporarySelectionState(plan);
  const effectiveAnchor = current.anchor || fallbackAnchor;
  if (!effectiveAnchor) {
    return plan;
  }
  return planSetTemporarySelectionState(
    plan,
    shiftSelect(
      {
        ...current,
        anchor: effectiveAnchor,
      },
      orderedKeys,
      targetViewKey
    )
  );
}

export function planClearTemporarySelection(plan: Plan, anchor?: string): Plan {
  return planSetTemporarySelectionState(
    plan,
    clearSelection({
      ...getTemporarySelectionState(plan),
      anchor: anchor ?? plan.temporaryView.anchor,
    })
  );
}

export function planSelectAllTemporaryRows(
  plan: Plan,
  orderedKeys: string[],
  anchor?: string
): Plan {
  return planSetTemporarySelectionState(plan, {
    baseSelection: OrderedSet<string>(orderedKeys),
    shiftSelection: OrderedSet<string>(),
    anchor: anchor ?? plan.temporaryView.anchor,
  });
}

export function planRemoveEmptyNodePosition(plan: Plan, nodeID: ID): Plan {
  return {
    ...plan,
    knowledgeDBs: removeEmptyNodeFromKnowledgeDBs(
      plan.knowledgeDBs,
      LOCAL,
      nodeID
    ),
    temporaryEvents: plan.temporaryEvents.push({
      type: "REMOVE_EMPTY_NODE",
      nodeID,
    }),
  };
}

export function planExpandNode(
  plan: Plan,
  view: View,
  viewPath: ViewPath
): Plan {
  if (view.expanded) {
    return plan;
  }
  return planUpdateViews(
    plan,
    updateView(plan.views, viewPath, {
      ...view,
      expanded: true,
    })
  );
}

export function planAddToParent(
  plan: Plan,
  targets: AddToParentTarget | AddToParentTarget[],
  parentID: ID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, ID[]] {
  const [updatedNodesPlan, actualItemIDs] = planAddTargetsToNode(
    plan,
    parentID,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews = bulkUpdateViewPathsAfterAddNode(updatedNodesPlan);

  return [planUpdateViews(updatedNodesPlan, updatedViews), actualItemIDs];
}

export function planAddSpansToParent(
  plan: Plan,
  spans: InlineSpan[],
  parentNode: GraphNode,
  insertAtIndex: number | undefined,
  relevance: Relevance,
  argument: Argument
): Plan {
  if (spans.every((span) => span.kind === "text")) {
    const [planWithNode, node] = planCreateNode(plan, spansText(spans));
    return planAddToParent(
      planWithNode,
      node,
      parentNode.id,
      insertAtIndex,
      relevance,
      argument
    )[0];
  }
  const node = {
    ...newGraphNode(spans, {
      root: parentNode.root,
      parent: parentNode.id,
      relevance,
      argument,
    }),
    ...(isStandaloneEmbedLink(spans) && {
      extraAttrs: { embed: "true" },
    }),
  };
  return planAddToParent(
    planUpsertNodes(plan, node),
    node.id,
    parentNode.id,
    insertAtIndex,
    relevance,
    argument
  )[0];
}

/**
 * Create a new node value for insertion into the current node tree.
 */
export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  const node: TextSeed = { text };
  return [plan, node];
}

export type ParsedLine = { text: string; depth: number };

export function parseClipboardText(text: string): ParsedLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const tabMatch = line.match(/^(\t*)/);
      const tabDepth = tabMatch ? tabMatch[1].length : 0;
      const spaceMatch = line.match(/^( +)/);
      const spaceDepth = spaceMatch ? Math.floor(spaceMatch[1].length / 2) : 0;
      const depth = tabDepth > 0 ? tabDepth : spaceDepth;
      const content = line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "");
      return { text: content, depth };
    })
    .filter((item) => item.text.length > 0);
}

type SaveNodeResult = {
  plan: Plan;
  viewPath: ViewPath;
  node: GraphNode;
};

export function planCreateNoteAtRoot(
  plan: Plan,
  spans: InlineSpan[],
  paneIndex: number
): SaveNodeResult {
  const text = spansText(spans);
  // Mint or link, root case: recognized entity text as a new document's
  // root mints the entity node — idempotently. If the entity already has
  // a home, nothing is created: the pane opens the existing document.
  const entityId = spans.every((span) => span.kind === "text")
    ? entityIdForText(text)
    : undefined;
  const existingHome = entityId
    ? getWorkspaceNode(plan.knowledgeDBs, entityId as ID)
    : undefined;
  if (entityId && existingHome) {
    const panesAtExisting = plan.panes.map((p, i) =>
      i === paneIndex
        ? {
            ...p,
            author: LOCAL,
            sourceId: LOCAL,
            documentId: undefined,
            rootNodeId: existingHome.root,
            fallbackLabel: undefined,
            searchQuery: undefined,
            searchResultIDs: undefined,
          }
        : p
    );
    return {
      plan: planUpdatePanes(plan, panesAtExisting),
      viewPath: [paneIndex, existingHome.root],
      node: existingHome,
    };
  }

  const createdNode = {
    ...withDocumentRoot(
      newGraphNode(spans, entityId ? { uuid: entityId } : {})
    ),
    ...(isStandaloneEmbedLink(spans) && {
      extraAttrs: { embed: "true" },
    }),
  };
  const planWithNode = planUpsertNodes(plan, createdNode);

  const newPanes = planWithNode.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: LOCAL,
          sourceId: LOCAL,
          documentId: undefined,
          rootNodeId: createdNode.id,
          fallbackLabel: undefined,
          searchQuery: undefined,
          searchResultIDs: undefined,
        }
      : p
  );

  const resultPlan = planUpdatePanes(planWithNode, newPanes);
  const newViewPath: ViewPath = [paneIndex, createdNode.id];

  return { plan: resultPlan, viewPath: newViewPath, node: createdNode };
}

export function planSaveNodeAndEnsureNodes(
  plan: Plan,
  spans: InlineSpan[],
  nodeID: ID,
  currentNode: GraphNode,
  viewPath: ViewPath,
  parentNode: GraphNode | undefined,
  parentViewPath: ViewPath | undefined,
  paneIndex: number,
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const text = spansText(spans);
  const trimmedText = text.trim();

  if (isEmptyNodeID(nodeID)) {
    if (!parentViewPath) {
      if (!trimmedText) return { plan, viewPath, node: currentNode };
      return planCreateNoteAtRoot(plan, spans, paneIndex);
    }

    if (!trimmedText) {
      const resultPlan = parentNode
        ? planRemoveEmptyNodePosition(plan, parentNode.id)
        : plan;
      return { plan: resultPlan, viewPath, node: currentNode };
    }

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = parentNode
      ? emptyNodeMetadata.get(parentNode.id)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = parentNode
      ? planRemoveEmptyNodePosition(plan, parentNode.id)
      : plan;

    const resultPlan = parentNode
      ? planAddSpansToParent(
          planWithoutEmpty,
          spans,
          parentNode,
          emptyNodeIndex,
          relevance ?? metadata?.nodeItem.relevance,
          argument ?? metadata?.nodeItem.argument
        )
      : planWithoutEmpty;
    return { plan: resultPlan, viewPath, node: currentNode };
  }

  if (isSearchId(nodeID)) {
    return { plan, viewPath, node: currentNode };
  }

  const nextSpans = calendarEntryEditedSpans(currentNode, nodeID, spans);

  if (spansToMarkdown(nextSpans) === spansToMarkdown(currentNode.spans)) {
    return { plan, viewPath, node: currentNode };
  }

  return {
    plan: planUpdateNodeSpans(plan, currentNode.id, nextSpans),
    viewPath,
    node: currentNode,
  };
}

export function getNextInsertPosition(
  plan: Plan,
  viewPath: ViewPath,
  nodeIsRoot: boolean,
  nodeIsExpanded: boolean,
  nodeIndex: number | undefined
): { parentPath: ViewPath; insertAt: number } | null {
  if (nodeIsRoot || nodeIsExpanded) {
    return { parentPath: viewPath, insertAt: 0 };
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) return null;

  return { parentPath, insertAt: (nodeIndex ?? 0) + 1 };
}

type ExecutePlan = (plan: Plan) => Promise<void>;

type Planner = {
  createPlan: () => Plan;
  executePlan: ExecutePlan;
  republishEvents: RepublishEvents;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

type PlanningContextValue = Pick<
  Planner,
  "executePlan" | "republishEvents" | "setPublishEvents"
> & {
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

const PlanningContext = React.createContext<PlanningContextValue | undefined>(
  undefined
);

export function buildDocumentWrites(plan: GraphPlan): {
  document: KnowstrDocument;
  content: string;
}[] {
  return plan.affectedDocuments.toArray().flatMap((docId) => {
    const rawDocument = plan.documents.get(documentKeyOf(LOCAL, docId));
    if (!rawDocument) {
      return [];
    }
    const document = withDocumentRealWorldEntities(
      plan.knowledgeDBs,
      plan.documents,
      plan.documentByFilePath,
      rawDocument
    );
    return [
      {
        document,
        content: renderDocumentMarkdown(plan.knowledgeDBs, document),
      },
    ];
  });
}

export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  if (!plan.user) {
    return plan.publishEvents;
  }
  const pubkey = plan.user.publicKey;
  const withUpserts = buildDocumentWrites(plan).reduce((events, write) => {
    const documentWithKey = {
      ...write.document,
      storageKey: write.document.storageKey ?? newStorageKey(),
    };
    const event = buildDocumentEvent(documentWithKey, pubkey, write.content);
    return events.push(event);
  }, plan.publishEvents);
  return plan.deletedDocs.reduce((events, docId) => {
    const deleteEvent: UnsignedEvent & EventAttachment = {
      kind: KIND_DELETE,
      pubkey,
      created_at: newTimestamp(),
      tags: [
        ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${pubkey}:${docId}`],
        ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
        msTag(),
      ],
      content: "",
      route: { kind: "storage" },
    };
    return events.push(deleteEvent);
  }, withUpserts);
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
  setPanes,
  setViews,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
}): JSX.Element {
  const executor = useExecutor();
  const setViewsRef = useRef(setViews);
  // eslint-disable-next-line functional/immutable-data
  setViewsRef.current = setViews;

  return (
    <PlanningContext.Provider
      value={{
        executePlan: executor.executePlan,
        republishEvents: executor.republishEvents,
        setPublishEvents,
        setPanes,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export function createPlan(
  props: Data & {
    publishEvents?: List<UnsignedEvent & EventAttachment>;
  }
): Plan {
  return {
    ...createGraphPlan(props),
    publishEventsStatus: props.publishEventsStatus,
    views: props.views,
    panes: props.panes,
    temporaryView: props.publishEventsStatus.temporaryView,
    temporaryEvents: List<TemporaryEvent>(),
    paneUpdate: false,
  };
}

export function usePlanner(): Planner {
  const data = useData();
  const dataRef = useRef(data);
  dataRef.current = data;
  const createPlanningContext = (): Plan => createPlan(dataRef.current);
  const planningContext = React.useContext(PlanningContext);
  if (planningContext === undefined) {
    throw new Error("PlanningContext not provided");
  }

  return {
    createPlan: createPlanningContext,
    executePlan: planningContext.executePlan,
    republishEvents: planningContext.republishEvents,
    setPublishEvents: planningContext.setPublishEvents,
    setPanes: planningContext.setPanes,
  };
}

// Plan function to set an empty node position (for creating new node editor)
// This is simpler than creating actual node events - just stores where to inject
export function planSetEmptyNodePosition(
  plan: Plan,
  parentID: ID,
  parentView: View,
  parentViewPath: ViewPath,
  paneIndex: number,
  insertIndex: number
): Plan {
  const parentNode = getWorkspaceNode(plan.knowledgeDBs, parentID);
  if (!parentNode) {
    return plan;
  }
  const planWithExpanded = planExpandNode(plan, parentView, parentViewPath);

  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID: parentNode.id,
      index: insertIndex,
      nodeItem: {
        children: List<ID>(),
        id: EMPTY_NODE_ID,
        spans: plainSpans(""),
        parent: parentNode.id,
        updated: Date.now(),
        root: parentNode.root,
        relevance: undefined,
      },
      paneIndex,
    }),
  };
}

export function planUpdateEmptyNodeMetadata(
  plan: Plan,
  nodeID: ID,
  metadata: { relevance?: Relevance; argument?: Argument }
): Plan {
  const currentMetadata = computeEmptyNodeMetadata(
    plan.publishEventsStatus.temporaryEvents
  );
  const existing = currentMetadata.get(nodeID);
  if (!existing) {
    return plan;
  }

  const updatedNodeItem: GraphNode = {
    ...existing.nodeItem,
    relevance: metadata.relevance ?? existing.nodeItem.relevance,
    argument: metadata.argument ?? existing.nodeItem.argument,
  };

  return {
    ...plan,
    temporaryEvents: plan.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID,
      index: existing.index,
      nodeItem: updatedNodeItem,
      paneIndex: existing.paneIndex,
    }),
  };
}
