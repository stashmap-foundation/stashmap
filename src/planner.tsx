/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, OrderedSet, Set as ImmutableSet } from "immutable";
import { nip19, UnsignedEvent } from "nostr-tools";
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
  getDocumentForNode,
  withDocumentRealWorldEntities,
} from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import { buildDocumentEvent } from "./nodesDocumentEvent";
import { newStorageKey } from "./storageEncryption";
import {
  EMPTY_NODE_ID,
  computeEmptyNodeMetadata,
  createRefTarget,
  createReferenceTarget,
  deleteNodes,
  getNode,
} from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planRecordKnowstrSource,
  planUpsertNodes,
  recognizedTargetSpans,
  withDocumentRoot,
} from "./core/plan";
import {
  newGraphNode,
  ViewPath,
  updateRowView,
  updateViewKey,
} from "./rowModel";
import {
  nodeRowKind,
  nodeTarget,
  nodeText,
  plainSpans,
  spansText,
  spansToMarkdown,
} from "./core/nodeSpans";
import {
  calendarFeedHref,
  calendarFeedTargetUrl,
  calendarFeedUrlFromSpans,
  isBareIcalFeedUrl,
} from "./core/ical";
import { classifyLinkHref } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";
import { routeCoordinateSourceId, sourceCoordinate } from "./navigationUrl";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";
import { entityIdForText } from "./core/entityRecognition";
import {
  MarkdownTreeNode,
  parseInlineSpans,
  parseMarkdown,
} from "./core/markdownTree";
import { parseMarkdownImportFiles } from "./core/markdownImport";
import { planInsertMarkdownTrees } from "./markdownPlan";
import { getWorkspaceNode } from "./core/knowledge";
import {
  ComposedRow,
  CompositionResult,
  writtenLine,
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

export type Gesture =
  | {
      kind: "judge";
      row: string;
      relevance: Relevance;
      argument: Argument;
    }
  | {
      kind: "dismiss";
      row: string;
    }
  | {
      kind: "reword";
      row: string;
      spans: InlineSpan[];
    }
  | {
      kind: "move";
      rows: string[];
      parent: string;
      after: string | undefined;
    }
  | {
      kind: "place";
      targets: (
        | {
            kind: "spans";
            spans: InlineSpan[];
            relevance: Relevance;
            argument: Argument;
          }
        | {
            kind: "node";
            id: ID;
            sourceId: SourceId;
            text: string;
            reference: boolean;
            relevance: Relevance;
            argument: Argument;
          }
        | {
            kind: "document";
            sourceId: SourceId;
            docId: string;
            filePath: string | undefined;
            text: string;
            relevance: Relevance;
            argument: Argument;
          }
        | {
            kind: "outline";
            lines: { text: string; depth: number }[];
          }
        | {
            kind: "markdown";
            files: { name: string; markdown: string }[];
          }
        | {
            kind: "clipboard";
            text: string;
          }
      )[];
      parent: string;
      after: string | undefined;
    };

export function movePositionWrites(
  parent: ComposedRow,
  moved: {
    id: ID;
    localID: ID | undefined;
    target: ID | undefined;
    chain: ID[];
    position: ComposedRow["position"];
    placement: boolean;
    reparented: boolean;
  }[],
  after: ComposedRow | undefined,
  anchorMoved: boolean
): { id: ID; names: ComposedRow["position"] }[] {
  const placementScope =
    parent.origin.kind === "written"
      ? parent.kind === "placement"
      : parent.origin.writeParentTarget !== undefined;
  const movedIds = new globalThis.Set(moved.map((seat) => seat.id));
  const seatFor = (
    row: ComposedRow
  ): Parameters<typeof movePositionWrites>[1][number] => ({
    id: row.id,
    localID:
      row.origin.kind === "written" && row.origin.writable
        ? row.origin.line.node.id
        : undefined,
    target: row.target,
    chain: row.chain,
    position: row.position,
    placement:
      row.origin.kind === "written" && row.origin.writable
        ? nodeRowKind(row.origin.line.node) === "placement"
        : true,
    reparented: false,
  });
  const stationary = parent.children
    .filter((row) => !movedIds.has(row.id))
    .map(seatFor);
  const anchorIndex =
    after === undefined
      ? -1
      : stationary.findIndex((seat) => seat.id === after.id);
  const desired = [
    ...stationary.slice(0, anchorIndex + 1),
    ...moved,
    ...stationary.slice(anchorIndex + 1),
  ];
  const anchorIDFor = (seat: typeof desired[number]): ID =>
    seat.localID ?? seat.id;
  const parentAnchor = parent.target ?? parent.id;
  const makePosition = (
    kind: ComposedRow["position"][number]["kind"],
    id: ID
  ): ComposedRow["position"][number] => ({
    kind,
    id,
  });
  const namesAt = (index: number): ComposedRow["position"] => {
    const seat = desired[index];
    const predecessor = desired[index - 1];
    const successor = movedIds.has(seat.id)
      ? desired.slice(index + 1).find((other) => !movedIds.has(other.id))
      : desired[index + 1];
    const siblings: ComposedRow["position"] = [
      ...(predecessor ? [makePosition("after", anchorIDFor(predecessor))] : []),
      ...(successor ? [makePosition("before", anchorIDFor(successor))] : []),
    ];
    return [
      ...siblings,
      ...(seat.reparented || (movedIds.has(seat.id) && siblings.length === 0)
        ? [makePosition("parent", parentAnchor)]
        : []),
    ];
  };
  const movedSeats = new globalThis.Set(
    moved.flatMap((seat) => [
      seat.id,
      ...(seat.localID !== undefined ? [seat.localID] : []),
      ...(seat.target !== undefined ? [seat.target] : []),
    ])
  );
  const affected = new globalThis.Set<ID>(
    moved.flatMap((seat) => (seat.localID !== undefined ? [seat.localID] : []))
  );
  desired.forEach((seat) => {
    if (
      seat.localID !== undefined &&
      seat.position.some((name) => movedSeats.has(name.id))
    ) {
      affected.add(seat.localID);
    }
  });
  const expandAffected = (): void => {
    const occupied = desired.flatMap((seat, index) =>
      seat.localID !== undefined && affected.has(seat.localID)
        ? [desired[index - 1]]
        : []
    );
    const displaced = desired.flatMap((seat) => {
      const occupies = occupied.some((predecessor) =>
        predecessor
          ? seat.position.some(
              (name) =>
                name.kind === "after" &&
                (name.id === predecessor.id ||
                  predecessor.chain.includes(name.id))
            )
          : seat.position.length > 0 &&
            seat.position.every((name) => name.kind === "parent")
      );
      return seat.localID !== undefined &&
        !affected.has(seat.localID) &&
        occupies
        ? [seat.localID]
        : [];
    });
    displaced.forEach((id) => affected.add(id));
    if (displaced.length > 0) {
      expandAffected();
    }
  };
  expandAffected();
  return desired.flatMap((seat, index) => {
    if (seat.localID === undefined || !affected.has(seat.localID)) {
      return [];
    }
    if (
      !placementScope &&
      (!seat.placement || (!anchorMoved && movedIds.has(seat.id)))
    ) {
      return seat.position.length === 0
        ? []
        : [{ id: seat.localID, names: [] }];
    }
    const names = namesAt(index);
    const signature = seat.position
      .map((name) => `${name.kind}:${name.id}`)
      .join(" ");
    const nextSignature = names
      .map((name) => `${name.kind}:${name.id}`)
      .join(" ");
    return signature === nextSignature ? [] : [{ id: seat.localID, names }];
  });
}

export function movePositionSeat(
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

export function writeFromForMove(
  row: ComposedRow,
  parent: ComposedRow
): ID | undefined {
  const writeKind = composedWriteKind(row);
  if (writeKind !== "placement" && writeKind !== "speaking") {
    return undefined;
  }
  const writtenTarget = parent.kind === "placement" ? parent.target : undefined;
  const scopeTarget =
    parent.origin.kind === "written"
      ? writtenTarget
      : parent.origin.writeParentTarget;
  return scopeTarget !== undefined && row.source.ancestors.includes(scopeTarget)
    ? undefined
    : row.origin.writeFrom;
}

export function dependentPositionWrites(
  row: ComposedRow
): { id: ID; names: ComposedRow["position"] }[] {
  const index = row.origin.physicalPeers.findIndex(
    (line) => line.id === row.id
  );
  const previous = index > 0 ? row.origin.physicalPeers[index - 1] : undefined;
  const writeKind = composedWriteKind(row);
  const represented =
    writeKind === "placement" || writeKind === "speaking"
      ? row.target
      : undefined;
  const reAnchor = represented ?? row.position[0]?.id ?? previous?.id;
  return row.origin.physicalPeers.flatMap((line) => {
    if (!line.position.some((name) => name.id === row.id)) {
      return [];
    }
    const names = line.position.flatMap((name) => {
      if (name.id !== row.id) {
        return [name];
      }
      return reAnchor === undefined ? [] : [{ ...name, id: reAnchor }];
    });
    return [{ id: line.id, names }];
  });
}

export function sourcePositionWrites(
  rows: { row: ComposedRow; sourceParent: ComposedRow | undefined }[]
): { id: ID; names: ComposedRow["position"] }[] {
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
  return parents.flatMap((sourceParent) => {
    const remaining = sourceParent.children.filter((row) => !moved.has(row));
    return remaining.flatMap((row, index) => {
      const line = writableLine(row);
      if (
        !line ||
        row.flags.includes("ambiguous-anchor") ||
        row.flags.includes("lapsed") ||
        !row.position.some((name) => seatIds.has(name.id))
      ) {
        return [];
      }
      const predecessor = remaining[index - 1];
      const successor = remaining[index + 1];
      const predecessorName: ComposedRow["position"][number] | undefined =
        predecessor ? { kind: "after", id: predecessor.id } : undefined;
      const successorName: ComposedRow["position"][number] | undefined =
        successor ? { kind: "before", id: successor.id } : undefined;
      const names = [predecessorName, successorName].flatMap((name) =>
        name ? [name] : []
      );
      return [{ id: line.node.id, names }];
    });
  });
}
export function writableLine(
  row: ComposedRow
): ComposedRow["origin"]["line"] | undefined {
  return row.origin.kind === "written" && row.origin.writable
    ? row.origin.line
    : undefined;
}
export function composedWriteKind(row: ComposedRow): ComposedRow["kind"] {
  const line = writableLine(row);
  return line ? nodeRowKind(line.node) : "placement";
}

export function rowEditing(row: ComposedRow): {
  calendar: boolean;
  reword: boolean;
  spans: InlineSpan[];
  target: ID | undefined;
  href: string | undefined;
} {
  const writeKind = composedWriteKind(row);
  const feedUrl =
    calendarFeedTargetUrl(row.target) ?? calendarFeedUrlFromSpans(row.spans);
  const calendar = row.editTarget !== undefined || feedUrl !== undefined;
  const reword =
    !calendar &&
    (writtenLine(row) === undefined ||
      ((writeKind === "placement" || writeKind === "speaking") &&
        row.target !== undefined &&
        classifyLinkHref(`#${row.target}`) === "node"));
  const rewordSpans: InlineSpan[] =
    writeKind === "placement" || writeKind === "speaking"
      ? [
          {
            kind: "link",
            href: `#${row.target ?? row.id}`,
            text: row.text,
          },
        ]
      : row.spans.filter(
          (span) => !(span.kind === "link" && span.struck === true)
        );
  const spans = reword ? rewordSpans : row.spans;
  const targetHref =
    row.editTarget !== undefined ? `#${row.editTarget}` : undefined;
  const href = targetHref ?? (feedUrl ? calendarFeedHref(feedUrl) : undefined);
  return { calendar, reword, spans, target: row.editTarget, href };
}

export function rewordedSpans(
  row: ComposedRow,
  spans: InlineSpan[]
): InlineSpan[] {
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

export function writeSpans(spans: InlineSpan[]): InlineSpan[] {
  const text = spansText(spans).trim();
  return isBareIcalFeedUrl(text)
    ? [{ kind: "link", href: calendarFeedHref(text), text }]
    : spans;
}

export function standaloneEmbedHref(spans: InlineSpan[]): string | undefined {
  const span =
    spans.length === 1 && spans[0]?.kind === "link" ? spans[0] : undefined;
  return span &&
    (span.href.startsWith("#") || classifyLinkHref(span.href) === "feed")
    ? span.href
    : undefined;
}
export function clearPosition(
  attrs: Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs ?? {}).filter(
      ([key]) => key !== "after" && key !== "before" && key !== "parent"
    )
  );
}

export function positionAttrs(
  names: ComposedRow["position"]
): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name.kind, name.id]));
}

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

function writeRow(plan: Plan, row: ComposedRow): [Plan, GraphNode | undefined] {
  const line = writableLine(row);
  const existing = line
    ? getWorkspaceNode(plan.knowledgeDBs, line.node.id)
    : undefined;
  if (existing) {
    return [plan, existing];
  }
  const writeParent = getWorkspaceNode(
    plan.knowledgeDBs,
    row.origin.writeParent
  );
  const parent = writeParent ?? row.origin.writeRoot;
  if (!parent) {
    return [plan, undefined];
  }
  const withParent = writeParent ? plan : planUpsertNodes(plan, parent);
  return !writeParent && row.origin.writeRoot
    ? [withParent, parent]
    : createPlacement(
        withParent,
        parent.id,
        row.origin.writeTarget,
        row.text,
        undefined,
        undefined
      );
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

function applyPositionWrites(
  plan: Plan,
  writes: { id: ID; names: ComposedRow["position"] }[]
): Plan {
  return writes.reduce((current, write) => {
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
  }, plan);
}

function applyMoveNames(
  plan: Plan,
  parent: ComposedRow,
  moved: Parameters<typeof movePositionWrites>[1],
  after: ComposedRow | undefined,
  anchorMoved: boolean
): Plan {
  return applyPositionWrites(
    plan,
    movePositionWrites(parent, moved, after, anchorMoved)
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

function writtenNode(plan: Plan, row: ComposedRow): GraphNode | undefined {
  const line = writableLine(row);
  const direct = line
    ? getWorkspaceNode(plan.knowledgeDBs, line.node.id)
    : undefined;
  if (direct) {
    return direct;
  }
  const scope = getWorkspaceNode(plan.knowledgeDBs, containingScope(row));
  if (!scope) {
    return undefined;
  }
  const original = new globalThis.Set(
    row.origin.writeChildren.map((child) => child.id)
  );
  return scope.children
    .toArray()
    .reverse()
    .flatMap((id) => {
      const node = getWorkspaceNode(plan.knowledgeDBs, id);
      return node ? [node] : [];
    })
    .find(
      (node) =>
        !original.has(node.id) && nodeTarget(node) === row.origin.writeTarget
    );
}

function repairDependentAnchors(plan: Plan, row: ComposedRow): Plan {
  return applyPositionWrites(plan, dependentPositionWrites(row));
}

function judge(
  plan: Plan,
  row: ComposedRow,
  relevance: Relevance,
  argument: Argument
): Plan {
  const existing = writtenNode(plan, row);
  if (existing) {
    const stamp = (current: Plan, node: GraphNode): Plan =>
      planUpsertNodes(current, {
        ...node,
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
  return createPlacement(
    withParent,
    parent.id,
    row.origin.writeTarget,
    row.text,
    ownRelevance,
    ownArgument
  )[0];
}

function repairSourceDependents(
  plan: Plan,
  rows: { row: ComposedRow; sourceParent: ComposedRow | undefined }[]
): Plan {
  return applyPositionWrites(plan, sourcePositionWrites(rows));
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
  const [withParent, parent] = writeRow(repaired, parentRow);
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
      const from = writeFromForMove(entry.row, parentRow);
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
      movePositionSeat(
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

export function placeGestureTarget(
  target: AddToParentTarget | undefined,
  id: ID,
  text: string,
  sourceId: SourceId,
  reference: boolean,
  relevance: Relevance,
  argument: Argument
): Extract<Gesture, { kind: "place" }>["targets"][number] {
  if (target === undefined) {
    return {
      kind: "node",
      id,
      sourceId,
      text,
      reference,
      relevance,
      argument,
    };
  }
  if (typeof target === "string") {
    return {
      kind: "node",
      id: target,
      sourceId,
      text,
      reference: false,
      relevance,
      argument,
    };
  }
  if ("targetID" in target) {
    return {
      kind: "node",
      id: target.targetID,
      sourceId,
      text: target.linkText ?? text,
      reference: target.reference === true,
      relevance,
      argument,
    };
  }
  if ("docId" in target) {
    return {
      kind: "document",
      sourceId: target.sourceId,
      docId: target.docId,
      filePath: target.filePath,
      text: target.linkText ?? text,
      relevance,
      argument,
    };
  }
  return {
    kind: "spans",
    spans: plainSpans(target.text),
    relevance,
    argument,
  };
}

function outlineTrees(
  lines: { text: string; depth: number }[]
): MarkdownTreeNode[] {
  if (lines.length === 0) {
    return [];
  }
  const minimum = Math.min(...lines.map((line) => line.depth));
  const roots: MarkdownTreeNode[] = [];
  const stack: MarkdownTreeNode[] = [];
  lines.forEach((line) => {
    const depth = line.depth - minimum;
    const node: MarkdownTreeNode = {
      spans: parseInlineSpans(line.text),
      children: [],
    };
    stack.length = Math.min(depth, stack.length);
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  });
  return roots;
}

function linkedTrees(
  plan: Plan,
  trees: MarkdownTreeNode[]
): MarkdownTreeNode[] {
  return trees.map((tree) => {
    const text = spansText(tree.spans);
    const recognized = tree.uuid
      ? undefined
      : recognizedTargetSpans(plan, text);
    return {
      ...tree,
      spans: recognized ?? tree.spans,
      ...(recognized && {
        extraAttrs: { ...tree.extraAttrs, embed: "true" },
      }),
      children: linkedTrees(plan, tree.children),
    };
  });
}

function recordSource(
  plan: Plan,
  target: GraphNode,
  sourceId: SourceId,
  sourceNode: GraphNode | undefined,
  docHint: string | undefined
): Plan {
  if (sourceId === LOCAL) {
    return plan;
  }
  const decoded = decodePublicKeyInputSync(sourceId);
  const coordinate =
    plan.panes
      .map((pane) => pane.routeCoordinate)
      .find(
        (candidate) =>
          candidate !== undefined &&
          (routeCoordinateSourceId(candidate) === sourceId ||
            candidate.pubkey === decoded)
      ) ?? sourceCoordinate(sourceId);
  const pubkey = coordinate?.pubkey ?? decoded;
  const sourceDocument = sourceNode
    ? getDocumentForNode(
        plan.knowledgeDBs,
        plan.documents,
        sourceNode,
        sourceId
      )
    : undefined;
  const doc = docHint ?? sourceDocument?.docId ?? coordinate?.dTag;
  return pubkey && doc
    ? planRecordKnowstrSource(plan, target, {
        author: nip19.npubEncode(pubkey),
        doc,
        relays: coordinate?.relays ?? [],
      })
    : plan;
}

function place(
  plan: Plan,
  parentRow: ComposedRow,
  after: ComposedRow | undefined,
  gesture: Extract<Gesture, { kind: "place" }>
): Plan {
  const [withParent, parent] = writeRow(plan, parentRow);
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
    (acc, entry) => {
      const at =
        insertAt === undefined ? undefined : insertAt + acc.seats.length;
      const [next, ids] = (() => {
        if (entry.kind === "spans") {
          return planAddSpansToParent(
            acc.plan,
            writeSpans(entry.spans),
            parent,
            at,
            entry.relevance,
            entry.argument
          );
        }
        if (entry.kind === "node") {
          return planAddTargetsToNode(
            acc.plan,
            parent.id,
            entry.reference
              ? createReferenceTarget(entry.id, entry.text)
              : createRefTarget(entry.id, entry.text),
            at,
            entry.relevance,
            entry.argument
          );
        }
        if (entry.kind === "document") {
          return planAddTargetsToNode(
            acc.plan,
            parent.id,
            {
              sourceId: entry.sourceId,
              docId: entry.docId,
              filePath: entry.filePath,
              linkText: entry.text,
            },
            at,
            entry.relevance,
            entry.argument
          );
        }
        const trees = (() => {
          if (entry.kind === "outline") {
            return outlineTrees(entry.lines);
          }
          if (entry.kind === "markdown") {
            return parseMarkdownImportFiles(entry.files);
          }
          return entry.text.split("\n").some((line) => /^#{1,6}\s/u.test(line))
            ? parseMarkdown(entry.text).tree
            : outlineTrees(parseClipboardText(entry.text));
        })();
        const inserted = planInsertMarkdownTrees(
          acc.plan,
          linkedTrees(acc.plan, trees),
          parent,
          at
        );
        return [inserted.plan, inserted.actualItemIDs];
      })();
      const nodes = ids.flatMap((id) => {
        const node = getWorkspaceNode(next.knowledgeDBs, id);
        return node ? [node] : [];
      });
      const href =
        entry.kind === "spans"
          ? standaloneEmbedHref(writeSpans(entry.spans))
          : undefined;
      const seats = nodes.map((node) => {
        const target =
          entry.kind === "node" && !entry.reference
            ? entry.id
            : href?.startsWith("#")
            ? href.slice(1)
            : href ?? nodeTarget(node);
        return {
          id: node.id,
          localID: node.id,
          target,
          chain: [node.id, ...(target !== undefined ? [target] : [])],
          position: [],
          placement: target !== undefined,
          reparented: false,
        };
      });
      return { plan: next, seats: [...acc.seats, ...seats] };
    },
    { plan: withParent, seats: [] }
  );
  const sourced = gesture.targets.reduce((current, target) => {
    if (target.kind === "node") {
      return recordSource(
        current,
        parent,
        target.sourceId,
        getNode(current.knowledgeDBs, target.id, target.sourceId),
        undefined
      );
    }
    return target.kind === "document"
      ? recordSource(current, parent, target.sourceId, undefined, target.docId)
      : current;
  }, added.plan);
  return after === undefined && parentRow.children.length === 0
    ? sourced
    : applyMoveNames(sourced, parentRow, added.seats, after, false);
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
): Plan {
  const [withRow, node] = writeRow(plan, row);
  if (!node) {
    return plan;
  }
  const { href, target } = rowEditing(row);
  const labelSpan: InlineSpan | undefined =
    href !== undefined && (target === undefined || node.id !== target)
      ? {
          kind: "link",
          href,
          text: spansText(spans),
        }
      : undefined;
  const editedSpans = labelSpan ? [labelSpan] : spans;
  return planUpdateNodeSpans(withRow, node.id, editedSpans);
}

export function applyGesture(
  plan: Plan,
  composition: CompositionResult,
  gesture: Gesture
): Plan {
  if (gesture.kind === "judge") {
    const row = rowForGesture(composition, gesture.row);
    return row ? judge(plan, row, gesture.relevance, gesture.argument) : plan;
  }
  if (gesture.kind === "dismiss") {
    const row = rowForGesture(composition, gesture.row);
    return row ? deleteComposedRow(plan, row) : plan;
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
    if (
      !parent ||
      rows.length !== gesture.rows.length ||
      (gesture.after && !after)
    ) {
      return plan;
    }
    const moved = move(plan, rows, parent, after);
    const parentNode = writtenNode(moved, parent);
    return parentNode
      ? rows.reduce(
          (current, { row }) =>
            recordSource(
              current,
              parentNode,
              row.origin.line.ref.sourceId,
              row.origin.line.node,
              undefined
            ),
          moved
        )
      : moved;
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
  const spans = writeSpans(gesture.spans);
  if (!rowEditing(row).reword) {
    return editComposedRow(plan, row, spans);
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
    ? planUpdateNodeSpans(withRow, node.id, rewordedSpans(row, spans))
    : plan;
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
  const nextEmbedHref = standaloneEmbedHref(spans);
  const stampEmbed =
    nextEmbedHref !== undefined &&
    nextEmbedHref !== standaloneEmbedHref(currentNode.spans);
  return planUpsertNodes(plan, {
    ...currentNode,
    spans,
    ...(stampEmbed && {
      extraAttrs: { ...currentNode.extraAttrs, embed: "true" },
    }),
    updated: nextUpdated(currentNode),
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

export function planRemoveEmptyNodePosition(
  plan: Plan,
  parentKey: string
): Plan {
  return {
    ...plan,
    temporaryEvents: plan.temporaryEvents.push({
      type: "REMOVE_EMPTY_NODE",
      parentKey,
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
    return planAddToParent(
      plan,
      { text: spansText(spans) },
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
    ...(standaloneEmbedHref(spans) !== undefined && {
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
    ...(standaloneEmbedHref(spans) !== undefined && {
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

function placeAtEmptyRow(
  plan: Plan,
  row: Extract<Row, { rowType: "empty" }>,
  targets: Extract<Gesture, { kind: "place" }>["targets"]
): Plan {
  const { parentKey } = row;
  const emptyNodes = computeEmptyNodeMetadata(
    plan.publishEventsStatus.temporaryEvents
  );
  const metadata = parentKey ? emptyNodes.get(parentKey) : undefined;
  const withoutEmpty = parentKey
    ? planRemoveEmptyNodePosition(plan, parentKey)
    : plan;
  return row.emptyParent && row.composition
    ? applyGesture(withoutEmpty, row.composition, {
        kind: "place",
        parent: row.emptyParent.key,
        targets,
        after: row.emptyParent.children[(metadata?.index ?? 0) - 1]?.key,
      })
    : withoutEmpty;
}

export function planPasteAtEmptyRow(
  plan: Plan,
  row: Extract<Row, { rowType: "empty" }>,
  spans: InlineSpan[],
  lines: ParsedLine[]
): Plan {
  const metadata = row.parentKey
    ? computeEmptyNodeMetadata(plan.publishEventsStatus.temporaryEvents).get(
        row.parentKey
      )
    : undefined;
  return placeAtEmptyRow(plan, row, [
    {
      kind: "spans",
      spans,
      relevance: metadata?.nodeItem.relevance,
      argument: metadata?.nodeItem.argument,
    },
    { kind: "outline", lines },
  ]);
}

export function planSaveVirtualNode(
  plan: Plan,
  spans: InlineSpan[],
  row: Extract<Row, { rowType: "empty" }>,
  paneIndex: number,
  relevance: Relevance,
  argument: Argument
): SaveNodeResult {
  const text = spansText(spans).trim();
  if (!row.parentViewPath) {
    return text
      ? planCreateNoteAtRoot(plan, spans, paneIndex)
      : { plan, viewPath: row.viewPath, node: row.node };
  }
  const { parentKey } = row;
  if (!text) {
    return {
      plan: parentKey ? planRemoveEmptyNodePosition(plan, parentKey) : plan,
      viewPath: row.viewPath,
      node: row.node,
    };
  }
  const metadata = parentKey
    ? computeEmptyNodeMetadata(plan.publishEventsStatus.temporaryEvents).get(
        parentKey
      )
    : undefined;
  const result = placeAtEmptyRow(plan, row, [
    {
      kind: "spans",
      spans,
      relevance: relevance ?? metadata?.nodeItem.relevance,
      argument: argument ?? metadata?.nodeItem.argument,
    },
  ]);
  return { plan: result, viewPath: row.viewPath, node: row.node };
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
  parentNode: GraphNode,
  parentView: View,
  parentViewPath: ViewPath,
  parentViewKey: string,
  parentKey: string,
  paneIndex: number,
  insertIndex: number
): Plan {
  const planWithExpanded = parentView.expanded
    ? plan
    : planUpdateViews(
        plan,
        updateViewKey(
          plan.views,
          parentViewKey,
          parentNode.id,
          parentViewPath.length === 2,
          { ...parentView, expanded: true }
        )
      );

  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      parentKey,
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
  parentKey: string,
  metadata: { relevance?: Relevance; argument?: Argument }
): Plan {
  const currentMetadata = computeEmptyNodeMetadata(
    plan.publishEventsStatus.temporaryEvents
  );
  const existing = currentMetadata.get(parentKey);
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
      parentKey,
      index: existing.index,
      nodeItem: updatedNodeItem,
      paneIndex: existing.paneIndex,
    }),
  };
}
