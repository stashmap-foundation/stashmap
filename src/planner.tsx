/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, OrderedSet, Set as ImmutableSet } from "immutable";
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
  deleteNodes,
  getNode,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planTakeComposedRow,
  planUpsertNodes,
  withDocumentRoot,
} from "./core/plan";
import {
  newGraphNode,
  ViewPath,
  updateRowView,
  updateViewKey,
} from "./rowModel";
import {
  nodeText,
  plainSpans,
  spansText,
  spansToMarkdown,
} from "./core/nodeSpans";
import { classifyLinkHref } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";
import { entityIdForText } from "./core/entityRecognition";
import { getWorkspaceNode } from "./core/knowledge";
import {
  Gesture,
  ComposedRow,
  CompositionResult,
  PositionName,
  clearPosition,
  movePositionWrites,
  positionAttrs,
  composedLine,
  composedWriteKind,
  writableLine,
} from "./core/composition";
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

function composedRowByKey(
  row: ComposedRow,
  key: string,
  parent: ComposedRow | undefined
): [ComposedRow, ComposedRow | undefined] | undefined {
  if (row.key === key) {
    return [row, parent];
  }
  return row.children.reduce<
    [ComposedRow, ComposedRow | undefined] | undefined
  >((found, child) => found ?? composedRowByKey(child, key, row), undefined);
}

function rowForGesture(
  composition: CompositionResult,
  key: string
): ComposedRow | undefined {
  return composedRowByKey(composition.root, key, undefined)?.[0];
}

function createPlacement(
  plan: Plan,
  parentID: ID,
  target: ID,
  text: string,
  relevance: Relevance,
  argument: Argument
): [Plan, GraphNode | undefined] {
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
  return planTakeComposedRow(plan, row);
}

export function nextUpdated(node: GraphNode): number {
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

function withoutAttrs(
  attrs: Record<string, string> | undefined,
  keys: string[]
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs ?? {}).filter(([key]) => !keys.includes(key))
  );
}

function rowSeat(
  row: ComposedRow,
  localID: ID | undefined,
  reparented: boolean
): Parameters<typeof movePositionWrites>[1][number] {
  return {
    id: row.id,
    localID: localID ?? writableLine(row)?.node.id,
    target: row.target,
    chain: row.chain,
    position: row.position,
    placement: composedWriteKind(row) === "placement",
    reparented,
  };
}

function applyMoveNames(
  plan: Plan,
  parent: ComposedRow,
  moved: Parameters<typeof movePositionWrites>[1],
  after: ComposedRow | undefined,
  anchorMoved: boolean
): Plan {
  return movePositionWrites(parent, moved, after, anchorMoved).reduce(
    (current, write) => {
      const node = getWorkspaceNode(current.knowledgeDBs, write.id);
      return node
        ? planUpsertNodes(current, {
            ...node,
            extraAttrs: {
              ...clearPosition(node.extraAttrs),
              ...positionAttrs(write.names),
            },
            updated: nextUpdated(node),
          })
        : current;
    },
    plan
  );
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
  const line = writableLine(row);
  const existingBonds =
    line && composedWriteKind(row) === "speaking"
      ? line.node.spans.filter(
          (span) => span.kind === "link" && span.struck === true
        )
      : [];
  const bonds: InlineSpan[] =
    existingBonds.length > 0
      ? existingBonds
      : [
          {
            kind: "link",
            href: `#${row.origin.writeTarget}`,
            text: row.text.trim(),
            struck: true,
          },
        ];
  return [...words, ...bonds];
}

function isRewording(row: ComposedRow, spans: InlineSpan[]): boolean {
  return (
    spansText(spans).trim() !== "" &&
    (writableLine(row) === undefined ||
      composedWriteKind(row) === "placement" ||
      composedWriteKind(row) === "speaking") &&
    spansText(spans).trim() !== row.text.trim()
  );
}

function evidenceParentFor(
  row: ComposedRow,
  argument: Argument
): GraphNode | undefined {
  return argument === undefined || row.source.parent === undefined
    ? undefined
    : row.effectiveParent?.node;
}

function containingScope(row: ComposedRow): ID {
  return row.origin.writeParent;
}

function repairDependentAnchors(plan: Plan, row: ComposedRow): Plan {
  const index = row.origin.physicalPeers.findIndex(
    (line) => line.id === row.id
  );
  const previous = index > 0 ? row.origin.physicalPeers[index - 1] : undefined;
  const represented =
    composedWriteKind(row) === "placement" ||
    composedWriteKind(row) === "speaking"
      ? row.target
      : undefined;
  const reAnchor = represented ?? row.position[0]?.id ?? previous?.id;
  return row.origin.physicalPeers.reduce((current, line) => {
    if (!line.position.some((name) => name.id === row.id)) {
      return current;
    }
    const sibling = getWorkspaceNode(current.knowledgeDBs, line.id);
    if (!sibling) {
      return current;
    }
    const names = line.position.flatMap((name) => {
      if (name.id !== row.id) {
        return [name];
      }
      return reAnchor === undefined ? [] : [{ ...name, id: reAnchor }];
    });
    return planUpsertNodes(current, {
      ...sibling,
      extraAttrs: {
        ...clearPosition(sibling.extraAttrs),
        ...positionAttrs(names),
      },
      updated: nextUpdated(sibling),
    });
  }, plan);
}

function judge(
  plan: Plan,
  row: ComposedRow,
  relevance: Relevance,
  argument: Argument,
  spans: InlineSpan[]
): Plan {
  const writable = writableLine(row);
  const existing = writable
    ? getWorkspaceNode(plan.knowledgeDBs, writable.node.id)
    : undefined;
  const rewording = isRewording(row, spans);
  const persistedSpans = rewording ? rewordingSpans(row, spans) : spans;
  if (existing) {
    const stamp = (current: Plan, node: GraphNode): Plan =>
      planUpsertNodes(current, {
        ...node,
        spans: (() => {
          if (
            (composedWriteKind(row) === "placement" ||
              composedWriteKind(row) === "speaking") &&
            !rewording
          ) {
            return node.spans;
          }
          if (spansText(persistedSpans).trim() === "") {
            return node.spans;
          }
          return spansText(persistedSpans).trim() === nodeText(node).trim()
            ? node.spans
            : persistedSpans;
        })(),
        relevance,
        argument,
        updated: nextUpdated(node),
      });
    const evidenceParent = evidenceParentFor(row, argument);
    const scope = getWorkspaceNode(plan.knowledgeDBs, containingScope(row));
    const boundAlready =
      evidenceParent === undefined ||
      scope === undefined ||
      row.origin.writeParentTarget === evidenceParent.id ||
      row.origin.physicalParentTarget === evidenceParent.id;
    if (boundAlready) {
      return stamp(plan, existing);
    }
    const knownParent = row.origin.writeChildren.find(
      (line) => line.target === evidenceParent.id
    );
    const parentLine = knownParent
      ? getWorkspaceNode(plan.knowledgeDBs, knownParent.id)
      : undefined;
    const [withParent, createdParent] = parentLine
      ? [plan, parentLine]
      : createPlacement(
          plan,
          scope.id,
          evidenceParent.id,
          nodeText(evidenceParent),
          undefined,
          undefined
        );
    if (!createdParent) {
      return stamp(plan, existing);
    }
    const moved = moveLocalNode(
      repairDependentAnchors(withParent, row),
      { ...existing, extraAttrs: clearPosition(existing.extraAttrs) },
      createdParent,
      undefined
    );
    const movedNode = getWorkspaceNode(moved.knowledgeDBs, existing.id);
    return movedNode ? stamp(moved, movedNode) : stamp(plan, existing);
  }
  const evidenceParent = evidenceParentFor(row, argument);
  const scope = getWorkspaceNode(plan.knowledgeDBs, containingScope(row));
  if (!scope) {
    return plan;
  }
  const knownParent = evidenceParent
    ? row.origin.writeChildren.find((line) => line.target === evidenceParent.id)
    : undefined;
  const persistedParent = knownParent
    ? getWorkspaceNode(plan.knowledgeDBs, knownParent.id)
    : undefined;
  const [withParent, parent] = evidenceParent
    ? row.origin.writeParentTarget === evidenceParent.id
      ? [plan, scope]
      : persistedParent
      ? [plan, persistedParent]
      : createPlacement(
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
  const ownRelevance = relevance !== row.relevance ? relevance : undefined;
  const ownArgument = argument !== row.argument ? argument : undefined;
  const [withRow, created] = createPlacement(
    withParent,
    parent.id,
    row.origin.writeTarget,
    row.text,
    ownRelevance,
    ownArgument
  );
  return created && rewording
    ? planUpdateNodeSpans(withRow, created.id, persistedSpans)
    : withRow;
}

function repairSourceDependents(
  plan: Plan,
  rows: { row: ComposedRow; sourceParent: ComposedRow | undefined }[]
): Plan {
  const moved = new globalThis.Set(rows.map((entry) => entry.row));
  const seatIds = new globalThis.Set(
    rows.flatMap((entry) => [
      entry.row.id,
      ...(entry.row.target ? [entry.row.target] : []),
    ])
  );
  const parents = rows
    .flatMap((entry) => (entry.sourceParent ? [entry.sourceParent] : []))
    .filter((parent, index, all) => all.indexOf(parent) === index);
  return parents.reduce((current, sourceParent) => {
    const remaining = sourceParent.children.filter((row) => !moved.has(row));
    return remaining.reduce((acc, row, index) => {
      const line = writableLine(row);
      const node = line
        ? getWorkspaceNode(acc.knowledgeDBs, line.node.id)
        : undefined;
      if (
        !node ||
        row.flags.includes("ambiguous-anchor") ||
        row.flags.includes("lapsed") ||
        !row.position.some((name) => seatIds.has(name.id))
      ) {
        return acc;
      }
      const predecessor = remaining[index - 1];
      const successor = remaining[index + 1];
      const names: PositionName[] = [
        ...(predecessor
          ? [{ kind: "after" as const, id: predecessor.id }]
          : []),
        ...(successor ? [{ kind: "before" as const, id: successor.id }] : []),
      ];
      return planUpsertNodes(acc, {
        ...node,
        extraAttrs: {
          ...clearPosition(node.extraAttrs),
          ...positionAttrs(names),
        },
        updated: nextUpdated(node),
      });
    }, current);
  }, plan);
}

function fromForMove(row: ComposedRow, parent: ComposedRow): ID | undefined {
  const writesPlacement =
    composedWriteKind(row) === "placement" ||
    composedWriteKind(row) === "speaking";
  if (!writesPlacement) {
    return undefined;
  }
  const scopeTarget =
    parent.origin.kind === "written"
      ? parent.kind === "placement"
        ? parent.target
        : undefined
      : parent.origin.writeParentTarget;
  return scopeTarget !== undefined && row.source.ancestors.includes(scopeTarget)
    ? undefined
    : row.origin.writeFrom;
}

function move(
  plan: Plan,
  rows: { row: ComposedRow; sourceParent: ComposedRow | undefined }[],
  parentRow: ComposedRow,
  after: ComposedRow | undefined
): Plan {
  const repaired = repairSourceDependents(
    plan,
    rows.filter((entry) => entry.sourceParent?.key !== parentRow.key)
  );
  const [withParent, parent] = localParentFor(repaired, parentRow);
  if (!parent) {
    return plan;
  }
  const movedRows = rows.reduce(
    (current, entry) => {
      const line = writableLine(entry.row);
      const existing = line
        ? getWorkspaceNode(current.plan.knowledgeDBs, line.node.id)
        : undefined;
      const [withRow, node] = existing
        ? [current.plan, existing]
        : createPlacement(
            current.plan,
            parent.id,
            entry.row.origin.writeTarget,
            entry.row.text,
            entry.row.ownRelevance,
            entry.row.ownArgument
          );
      if (!node) {
        return current;
      }
      const from = fromForMove(entry.row, parentRow);
      const recorded =
        from === undefined
          ? entry.row.origin.recordedFrom === undefined
            ? node
            : { ...node, extraAttrs: withoutAttrs(node.extraAttrs, ["from"]) }
          : entry.row.origin.recordedFrom === from
          ? node
          : { ...node, extraAttrs: { ...node.extraAttrs, from } };
      const moved = moveLocalNode(withRow, recorded, parent, current.afterID);
      return {
        plan: moved,
        ids: new globalThis.Map([...current.ids, [entry.row.id, node.id]]),
        afterID: node.id,
      };
    },
    {
      plan: withParent,
      ids: new globalThis.Map<ID, ID>(),
      afterID: after?.origin.kind === "written" ? after.id : undefined,
    }
  );
  return applyMoveNames(
    movedRows.plan,
    parentRow,
    rows.map((entry) =>
      rowSeat(
        entry.row,
        movedRows.ids.get(entry.row.id),
        entry.sourceParent?.key !== parentRow.key
      )
    ),
    after,
    true
  );
}

export function moveGestureRows(
  rows: Row[]
): Extract<Gesture, { kind: "move" }>["rows"] {
  return rows.flatMap((row) =>
    row.rowType === "occurrence" ? [row.occurrence.key] : []
  );
}

function targetOfAddedLine(target: AddToParentTarget): ID | undefined {
  if (typeof target === "string") {
    return undefined;
  }
  if ("targetID" in target) {
    return target.reference === true ? undefined : target.targetID;
  }
  return "text" in target ? entityIdForText(target.text) : undefined;
}

function place(
  plan: Plan,
  parentRow: ComposedRow,
  after: ComposedRow | undefined,
  gesture: Extract<Gesture, { kind: "place" }>
): Plan {
  const [withParent, parent] = localParentFor(plan, parentRow);
  if (!parent) {
    return plan;
  }
  const afterLine = after ? writableLine(after) : undefined;
  const afterIndex = afterLine
    ? parent.children.indexOf(afterLine.node.id)
    : -1;
  const insertAt =
    after === undefined ? 0 : afterIndex < 0 ? undefined : afterIndex + 1;
  const added = gesture.targets.reduce<{
    plan: Plan;
    seats: Parameters<typeof movePositionWrites>[1];
  }>(
    (acc, entry, index) => {
      const [next, ids] =
        entry.kind === "spans"
          ? planAddSpansToParent(
              acc.plan,
              entry.spans,
              parent,
              insertAt === undefined ? undefined : insertAt + index,
              entry.relevance,
              entry.argument
            )
          : planAddTargetsToNode(
              acc.plan,
              parent.id,
              entry.target,
              insertAt === undefined ? undefined : insertAt + index,
              entry.relevance,
              entry.argument
            );
      const node =
        ids[0] === undefined
          ? undefined
          : getWorkspaceNode(next.knowledgeDBs, ids[0]);
      if (!node) {
        return { plan: next, seats: acc.seats };
      }
      const href =
        entry.kind === "spans" ? soleEmbedLinkHref(entry.spans) : undefined;
      const target =
        entry.kind === "target"
          ? targetOfAddedLine(entry.target)
          : href?.startsWith("#")
          ? href.slice(1)
          : href;
      return {
        plan: next,
        seats: [
          ...acc.seats,
          {
            id: node.id,
            localID: node.id,
            target,
            chain: [node.id, ...(target !== undefined ? [target] : [])],
            position: [],
            placement: target !== undefined,
            reparented: false,
          },
        ],
      };
    },
    { plan: withParent, seats: [] }
  );
  return applyMoveNames(added.plan, parentRow, added.seats, after, false);
}

function resetInvalidPanes(plan: Plan, paneIndex?: number): Plan {
  const panes = plan.panes.map((pane, index) => {
    const reset =
      index === paneIndex ||
      (pane.rootNodeId !== undefined &&
        getNode(plan.knowledgeDBs, pane.rootNodeId, pane.sourceId) ===
          undefined);
    return reset ? { ...pane, rootNodeId: undefined } : pane;
  });
  return planUpdatePanes(plan, panes);
}

function deleteComposedRow(plan: Plan, row: ComposedRow): Plan {
  const line = writableLine(row);
  const node = line
    ? getWorkspaceNode(plan.knowledgeDBs, line.node.id)
    : undefined;
  if (!node) {
    return plan;
  }
  const parent =
    row.origin.physicalParent?.sourceId === LOCAL
      ? getWorkspaceNode(plan.knowledgeDBs, row.origin.physicalParent.id)
      : undefined;
  if (parent) {
    const index = parent.children.indexOf(node.id);
    if (index < 0) {
      return plan;
    }
    const repaired = repairDependentAnchors(plan, row);
    const currentParent = getWorkspaceNode(repaired.knowledgeDBs, parent.id);
    if (!currentParent) {
      return plan;
    }
    const withoutChild = planUpsertNodes(
      repaired,
      deleteNodes(currentParent, ImmutableSet([index]))
    );
    const withoutDescendants = planDeleteDescendantNodes(withoutChild, node);
    const withoutNode = planDeleteNodes(withoutDescendants, node.id);
    return resetInvalidPanes(withoutNode);
  }
  const withoutDescendants = planDeleteDescendantNodes(plan, node);
  return resetInvalidPanes(planDeleteNodes(withoutDescendants, node.id));
}

function editComposedRow(
  plan: Plan,
  row: ComposedRow,
  spans: InlineSpan[]
): [Plan, GraphNode | undefined] {
  const [withRow, node] = planTakeComposedRow(plan, row);
  if (!node) {
    return [plan, undefined];
  }
  const labelSpan: InlineSpan | undefined =
    row.editTarget !== undefined && node.id !== row.editTarget
      ? {
          kind: "link",
          href: `#${row.editTarget}`,
          text: spansText(spans),
        }
      : undefined;
  const editedSpans = labelSpan ? [labelSpan] : spans;
  const edited = planUpdateNodeSpans(withRow, node.id, editedSpans);
  return [edited, getWorkspaceNode(edited.knowledgeDBs, node.id)];
}

export function applyGesture(
  plan: Plan,
  composition: CompositionResult,
  gesture: Gesture
): Plan {
  if (gesture.kind === "judge") {
    const row = rowForGesture(composition, gesture.row);
    return row
      ? judge(plan, row, gesture.relevance, gesture.argument, gesture.spans)
      : plan;
  }
  if (gesture.kind === "dismiss") {
    const row = rowForGesture(composition, gesture.row);
    return row
      ? gesture.remove
        ? deleteComposedRow(plan, row)
        : judge(plan, row, "not_relevant", row.argument, gesture.spans)
      : plan;
  }
  if (gesture.kind === "move") {
    const parent = rowForGesture(composition, gesture.parent);
    const after = gesture.after
      ? rowForGesture(composition, gesture.after)
      : undefined;
    const rows = gesture.rows.flatMap((key) => {
      const found = composedRowByKey(composition.root, key, undefined);
      return found ? [{ row: found[0], sourceParent: found[1] }] : [];
    });
    return parent &&
      rows.length === gesture.rows.length &&
      (!gesture.after || after)
      ? move(plan, rows, parent, after)
      : plan;
  }
  if (gesture.kind === "place") {
    const parent = rowForGesture(composition, gesture.parent);
    const after = gesture.after
      ? rowForGesture(composition, gesture.after)
      : undefined;
    return parent && (!gesture.after || after)
      ? place(plan, parent, after, gesture)
      : plan;
  }
  const row = rowForGesture(composition, gesture.row);
  if (!row) {
    return plan;
  }
  if (
    composedWriteKind(row) !== "placement" &&
    composedWriteKind(row) !== "speaking"
  ) {
    return editComposedRow(plan, row, gesture.spans)[0];
  }
  const line = writableLine(row);
  const existing = line
    ? getWorkspaceNode(plan.knowledgeDBs, line.node.id)
    : undefined;
  const scope = getWorkspaceNode(plan.knowledgeDBs, containingScope(row));
  if (!scope) {
    return plan;
  }
  const [withRow, node] = existing
    ? [plan, existing]
    : createPlacement(
        plan,
        scope.id,
        row.origin.writeTarget,
        row.text,
        row.ownRelevance,
        row.ownArgument
      );
  return node
    ? planUpdateNodeSpans(withRow, node.id, rewordingSpans(row, gesture.spans))
    : plan;
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

export function planExpandRow(plan: Plan, row: Row): Plan {
  if (row.view.expanded) {
    return plan;
  }
  return planUpdateViews(
    plan,
    updateRowView(plan.views, row, {
      ...row.view,
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
  return [updatedNodesPlan, actualItemIDs];
}

function planAddSpansToParent(
  plan: Plan,
  spans: InlineSpan[],
  parentNode: GraphNode,
  insertAtIndex: number | undefined,
  relevance: Relevance,
  argument: Argument
): [Plan, ID[]] {
  if (spans.every((span) => span.kind === "text")) {
    const [planWithNode, node] = planCreateNode(plan, spansText(spans));
    return planAddToParent(
      planWithNode,
      node,
      parentNode.id,
      insertAtIndex,
      relevance,
      argument
    );
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
  );
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

export function planSaveComposedRow(
  plan: Plan,
  spans: InlineSpan[],
  row: ComposedRow,
  viewPath: ViewPath
): SaveNodeResult {
  const [edited, node] = editComposedRow(plan, row, spans);
  return {
    plan: edited,
    viewPath,
    node: node ?? composedLine(row).node,
  };
}

export function planSaveVirtualNode(
  plan: Plan,
  spans: InlineSpan[],
  nodeID: ID,
  currentNode: GraphNode,
  viewPath: ViewPath,
  parent: ComposedRow | undefined,
  composition: CompositionResult | undefined,
  parentNodeID: ID | undefined,
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
      const resultPlan = parentNodeID
        ? planRemoveEmptyNodePosition(plan, parentNodeID)
        : plan;
      return { plan: resultPlan, viewPath, node: currentNode };
    }

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = parentNodeID
      ? emptyNodeMetadata.get(parentNodeID)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;
    const planWithoutEmpty = parentNodeID
      ? planRemoveEmptyNodePosition(plan, parentNodeID)
      : plan;
    const resultPlan =
      parent && composition
        ? applyGesture(planWithoutEmpty, composition, {
            kind: "place",
            parent: parent.key,
            targets: [
              {
                kind: "spans",
                spans,
                relevance: relevance ?? metadata?.nodeItem.relevance,
                argument: argument ?? metadata?.nodeItem.argument,
              },
            ],
            after: parent.children[emptyNodeIndex - 1]?.key,
          })
        : planWithoutEmpty;
    return { plan: resultPlan, viewPath, node: currentNode };
  }

  return { plan, viewPath, node: currentNode };
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

export function planSetEmptyNodePosition(
  plan: Plan,
  parentID: ID,
  parentView: View,
  parentViewPath: ViewPath,
  parentViewKey: string,
  paneIndex: number,
  insertIndex: number
): Plan {
  const parentNode = getWorkspaceNode(plan.knowledgeDBs, parentID);
  if (!parentNode) {
    return plan;
  }
  const planWithExpanded = parentView.expanded
    ? plan
    : planUpdateViews(
        plan,
        updateViewKey(
          plan.views,
          parentViewKey,
          parentID,
          parentViewPath.length === 2,
          { ...parentView, expanded: true }
        )
      );

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
