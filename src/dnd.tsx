import React from "react";
import { List } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { nip19 } from "nostr-tools";
import { LOCAL } from "./core/nodeRef";
import {
  createRefTarget,
  createReferenceTarget,
  getNode,
} from "./core/connections";
import { nodeText } from "./core/nodeSpans";
import { isCalendarEntryId } from "./core/ical";
import { composedLine, writableLine } from "./core/composition";
import {
  getIndependentRows,
  getVisibleParentRow,
  viewPathContains,
} from "./rowModel";
import { getDocumentForNode } from "./core/Document";
import {
  Plan,
  applyGesture,
  moveGestureRows,
  planExpandRow,
  AddToParentTarget,
} from "./planner";
import { planRecordKnowstrSource } from "./core/plan";
import { sourceCoordinate } from "./navigationUrl";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";

type DragSource = {
  row: Row;
  draggedRows: Row[];
  orderedRows: List<Row>;
  sourcePaneIndex: number;
  text?: string;
  isCopyDrag?: boolean;
  altCopy?: boolean;
  nodeId?: ID;
  targetId?: ID;
  insertTarget?: AddToParentTarget;
};

function addFallbackLinkText(
  target: AddToParentTarget,
  text: string | undefined
): AddToParentTarget {
  if (typeof target === "string" || !("targetID" in target)) {
    return target;
  }
  if (target.linkText || !text) {
    return target;
  }
  return createRefTarget(target.targetID, text);
}

function planRecordForeignSource(
  plan: Plan,
  sourcePane: Pane | undefined,
  sourceRow: Row,
  targetNode: GraphNode
): Plan {
  if (sourceRow.sourceId === LOCAL) {
    return plan;
  }
  const coordinate =
    sourcePane?.routeCoordinate ?? sourceCoordinate(sourceRow.sourceId);
  const pubkey =
    coordinate?.pubkey ?? decodePublicKeyInputSync(sourceRow.sourceId);
  if (!pubkey) {
    return plan;
  }
  const sourceDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    sourceRow.node,
    sourceRow.sourceId
  );
  const doc = sourceDocument?.docId ?? coordinate?.dTag;
  if (!doc) {
    return plan;
  }
  return planRecordKnowstrSource(plan, targetNode, {
    author: nip19.npubEncode(pubkey),
    doc,
    relays: coordinate?.relays ?? [],
  });
}

export function isDraggedOccurrence(row: Row, sources: Row[]): boolean {
  return sources.some((source) =>
    viewPathContains(source.viewPath, row.viewPath)
  );
}

function getVisibleRootRow(rows: List<Row>): Row | undefined {
  const firstRow = rows.first();
  if (!firstRow || firstRow.parentRef) {
    return undefined;
  }
  return firstRow;
}

function getDropDestinationEndOfVisibleRoot(
  rows: List<Row>
): { parentRow: Row; insertAtIndex: number } | undefined {
  const rootRow = getVisibleRootRow(rows);
  return rootRow
    ? {
        parentRow: rootRow,
        insertAtIndex: rootRow.node.children.size || 0,
      }
    : undefined;
}

function placedIndexAfter(rows: List<Row>, row: Row): number {
  const previousPlaced = rows
    .slice(0, row.index)
    .reverse()
    .find(
      (candidate) =>
        candidate.childIndex !== undefined &&
        candidate.parentRef?.sourceId === row.parentRef?.sourceId &&
        candidate.parentRef?.id === row.parentRef?.id
    );
  return previousPlaced?.childIndex !== undefined
    ? previousPlaced.childIndex + 1
    : 0;
}

type DropDestination = {
  parentRow: Row;
  insertAtIndex: number;
  anchorRow?: Row;
};

function getInsertAfterRow(
  rows: List<Row>,
  row: Row
): DropDestination | undefined {
  if (!row.parentRef) {
    return {
      parentRow: row,
      insertAtIndex: row.node.children.size || 0,
    };
  }
  const parentRow = getVisibleParentRow(rows, row);
  if (!parentRow) {
    return undefined;
  }
  return {
    parentRow,
    insertAtIndex:
      row.childIndex !== undefined
        ? row.childIndex + 1
        : placedIndexAfter(rows, row),
    anchorRow: row,
  };
}

function getAncestorAtDepth(
  rows: List<Row>,
  rowIndex: number,
  depth: number
): Row | undefined {
  const row = rows.get(rowIndex);
  if (!row) {
    return undefined;
  }
  if (row.depth <= depth) {
    return row;
  }
  return rows
    .slice(0, rowIndex)
    .reverse()
    .find((candidate) => candidate.depth === depth);
}

function getDropBeforeParentDestination(
  rows: List<Row>,
  dropBefore: Row
): DropDestination | undefined {
  const parentRow = getVisibleParentRow(rows, dropBefore);
  if (!parentRow) {
    return getDropDestinationEndOfVisibleRoot(rows);
  }
  const displayPredecessor = rows.get(dropBefore.index - 1);
  const anchorRow =
    displayPredecessor &&
    displayPredecessor.parentRef?.sourceId === dropBefore.parentRef?.sourceId &&
    displayPredecessor.parentRef?.id === dropBefore.parentRef?.id
      ? displayPredecessor
      : undefined;
  return {
    parentRow,
    insertAtIndex: dropBefore.childIndex ?? placedIndexAfter(rows, dropBefore),
    anchorRow,
  };
}

function getRootDepth(rows: List<Row>): number {
  const firstRow = rows.first();
  if (!firstRow) {
    return 0;
  }
  return firstRow.parentRef ? firstRow.depth - 1 : firstRow.depth;
}

function findNextNonDraggedRow(
  rows: List<Row>,
  startIndex: number,
  sources: Row[]
): Row | undefined {
  return rows
    .slice(startIndex)
    .find((row) => !isDraggedOccurrence(row, sources));
}

function resolveDropByDepth(
  rows: List<Row>,
  prevRow: Row,
  dropBefore: Row | undefined,
  targetDepth: number
): { parentRow: Row; insertAtIndex: number } | undefined {
  const rootDepth = getRootDepth(rows);
  const maxDepth = prevRow.depth + 1;
  const minDepth = dropBefore ? dropBefore.depth : rootDepth + 1;
  const clampedDepth = Math.max(minDepth, Math.min(maxDepth, targetDepth));

  if (clampedDepth === prevRow.depth + 1) {
    if (dropBefore && dropBefore.depth === clampedDepth) {
      return {
        parentRow: prevRow,
        insertAtIndex: dropBefore.childIndex ?? prevRow.node.children.size,
      };
    }
    return {
      parentRow: prevRow,
      insertAtIndex: prevRow.node.children.size || 0,
    };
  }

  const ancestor = getAncestorAtDepth(rows, prevRow.index, clampedDepth);
  if (ancestor) {
    const afterAncestor = getInsertAfterRow(rows, ancestor);
    if (afterAncestor) {
      return afterAncestor;
    }
  }

  return getDropDestinationEndOfVisibleRoot(rows);
}

export function getDropDestinationFromRows(
  rows: List<Row>,
  targetRow: Row,
  targetDepth: number | undefined,
  sources: Row[]
): DropDestination | undefined {
  const dropBefore = findNextNonDraggedRow(rows, targetRow.index + 1, sources);

  if (targetDepth !== undefined) {
    return resolveDropByDepth(rows, targetRow, dropBefore, targetDepth);
  }

  if (!dropBefore) {
    return getInsertAfterRow(rows, targetRow);
  }
  if (targetRow.depth > dropBefore.depth) {
    const afterTarget = getInsertAfterRow(rows, targetRow);
    if (afterTarget) {
      return afterTarget;
    }
  }
  return getDropBeforeParentDestination(rows, dropBefore);
}

export function dnd(
  basePlan: Plan,
  sourceDrag: DragSource,
  targetParentRow: Row,
  dropIndex: number,
  dropAnchor: Row | undefined
): Plan {
  const source = sourceDrag.row.viewKey;
  const sources = sourceDrag.draggedRows.length
    ? sourceDrag.draggedRows
    : [sourceDrag.row];
  const independentRows = getIndependentRows(sources);
  const dropIntoOwnDescendant = independentRows.some((row) =>
    viewPathContains(row.viewPath, targetParentRow.viewPath)
  );
  if (dropIntoOwnDescendant) {
    return basePlan;
  }
  const sourcePane = basePlan.panes[sourceDrag.sourcePaneIndex];
  const rootOf = (row: Row): ID | undefined => {
    if (row.rowType !== "occurrence") {
      return undefined;
    }
    const line = writableLine(row.occurrence);
    if (line) {
      return line.node.root;
    }
    return getNode(
      basePlan.knowledgeDBs,
      row.occurrence.origin.writeParent,
      LOCAL
    )?.root;
  };
  const targetRoot = rootOf(targetParentRow);
  const localRoot =
    targetRoot === undefined
      ? undefined
      : getNode(basePlan.knowledgeDBs, targetRoot, LOCAL);
  const recordForeignSources = (plan: Plan): Plan =>
    localRoot
      ? independentRows.reduce(
          (acc, row) =>
            row.sourceId === LOCAL
              ? acc
              : planRecordForeignSource(acc, sourcePane, row, localRoot),
          plan
        )
      : plan;
  const sourceDocument = getDocumentForNode(
    basePlan.knowledgeDBs,
    basePlan.documents,
    sourceDrag.row.rowType === "occurrence"
      ? composedLine(sourceDrag.row.occurrence).node
      : sourceDrag.row.node,
    sourceDrag.row.rowType === "occurrence"
      ? composedLine(sourceDrag.row.occurrence).ref.sourceId
      : sourceDrag.row.sourceId
  );
  const targetDocument = getDocumentForNode(
    basePlan.knowledgeDBs,
    basePlan.documents,
    targetParentRow.rowType === "occurrence"
      ? composedLine(targetParentRow.occurrence).node
      : targetParentRow.node,
    targetParentRow.rowType === "occurrence"
      ? composedLine(targetParentRow.occurrence).ref.sourceId
      : targetParentRow.sourceId
  );
  const sameDocument =
    sourceDocument !== undefined &&
    targetDocument !== undefined &&
    sourceDocument.sourceId === targetDocument.sourceId &&
    sourceDocument.docId === targetDocument.docId;
  const rowTargetID = (row: Row): ID =>
    (row.viewKey === source
      ? sourceDrag.targetId || sourceDrag.nodeId
      : undefined) ??
    (row.rowType === "occurrence"
      ? row.occurrence.target ?? row.occurrence.id
      : row.node.id);
  const rowCopies = (row: Row): boolean =>
    sourceDrag.isCopyDrag === true ||
    (sourceDrag.altCopy === true &&
      (!sameDocument || isCalendarEntryId(rowTargetID(row))));
  if (
    sourceDrag.isCopyDrag !== true &&
    independentRows.some((row) => !row.parentRef) &&
    sameDocument
  ) {
    return basePlan;
  }
  const doorTarget =
    targetParentRow.rowType === "occurrence"
      ? targetParentRow.occurrence
      : undefined;
  const moveRows =
    doorTarget !== undefined && targetRoot !== undefined
      ? independentRows.filter(
          (row) =>
            row.rowType === "occurrence" &&
            rootOf(row) === targetRoot &&
            !rowCopies(row)
        )
      : [];
  const rest = independentRows.filter((row) => !moveRows.includes(row));
  const movedPlan = (() => {
    if (moveRows.length === 0 || doorTarget === undefined) {
      return basePlan;
    }
    const rows = moveGestureRows(moveRows, sourceDrag.orderedRows);
    return applyGesture(
      recordForeignSources(planExpandRow(basePlan, targetParentRow)),
      {
        kind: "move",
        rows,
        parent: doorTarget,
        after:
          dropAnchor?.rowType === "occurrence"
            ? dropAnchor.occurrence
            : undefined,
      }
    );
  })();
  if (rest.length === 0 || doorTarget === undefined) {
    return movedPlan;
  }
  const targets = rest.map((row) => {
    const isPrimarySource = row.viewKey === source;
    const insertTarget =
      (isPrimarySource ? sourceDrag.insertTarget : undefined) ??
      row.incomingTarget;
    const dragTargetID = isPrimarySource
      ? sourceDrag.targetId || sourceDrag.nodeId
      : undefined;
    const occurrence =
      row.rowType === "occurrence" ? row.occurrence : undefined;
    const targetID =
      dragTargetID ?? occurrence?.target ?? occurrence?.id ?? row.node.id;
    const makeTarget =
      sourceDrag.altCopy === true && isCalendarEntryId(targetID)
        ? createReferenceTarget
        : createRefTarget;
    const target = insertTarget
      ? addFallbackLinkText(insertTarget, sourceDrag.text)
      : makeTarget(targetID, occurrence?.text ?? nodeText(row.node));
    const edge = occurrence ? composedLine(occurrence).node : row.node;
    return { target, relevance: edge.relevance, argument: edge.argument };
  });
  return applyGesture(
    recordForeignSources(planExpandRow(movedPlan, targetParentRow)),
    {
      kind: "place",
      targets,
      parent: doorTarget,
      at: dropIndex + moveRows.length,
      after:
        dropAnchor?.rowType === "occurrence"
          ? dropAnchor.occurrence
          : undefined,
    }
  );
}

function CustomDragLayer(): JSX.Element | null {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging(),
    item: monitor.getItem() as { text?: string } | null,
    currentOffset: monitor.getClientOffset() as XYCoord | null,
  }));

  if (!isDragging || !item?.text || !currentOffset) {
    return null;
  }

  const x = currentOffset.x || 0;
  const y = currentOffset.y || 0;

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 1000,
        left: x + 12,
        top: y - 8,
        opacity: 0.6,
        fontSize: "14px",
        maxWidth: "200px",
      }}
    >
      {item.text}
    </div>
  );
}

/* eslint-disable functional/immutable-data */
const dragModifier = { alt: false, altKeyHeld: false };

export function takeAltDrag(): boolean {
  const pressed = dragModifier.alt || dragModifier.altKeyHeld;
  dragModifier.alt = false;
  dragModifier.altKeyHeld = false;
  return pressed;
}

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  React.useEffect(() => {
    const recordDrag = (event: DragEvent): void => {
      if (typeof event.altKey === "boolean") {
        dragModifier.alt = event.altKey;
      }
    };
    const recordKey = (event: KeyboardEvent): void => {
      if (event.key === "Alt") {
        dragModifier.altKeyHeld = event.type === "keydown";
      }
    };
    const clear = (): void => {
      dragModifier.alt = false;
      dragModifier.altKeyHeld = false;
    };
    window.addEventListener("dragover", recordDrag, true);
    window.addEventListener("drop", recordDrag, true);
    window.addEventListener("keydown", recordKey, true);
    window.addEventListener("keyup", recordKey, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragover", recordDrag, true);
      window.removeEventListener("drop", recordDrag, true);
      window.removeEventListener("keydown", recordKey, true);
      window.removeEventListener("keyup", recordKey, true);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return (
    <DndProvider backend={HTML5Backend}>
      <CustomDragLayer />
      {children}
    </DndProvider>
  );
}
/* eslint-enable functional/immutable-data */
