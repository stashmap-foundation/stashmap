import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { nip19 } from "nostr-tools";
import {
  createRefTarget,
  getNode,
  isEmptyNodeID,
  isSearchId,
} from "./core/connections";
import { LOCAL } from "./core/nodeRef";
import {
  GraphLookup,
  graphLookupFromData,
  resolveAuthoredFirst,
} from "./core/graphLookup";
import { getWorkspaceNode } from "./core/knowledge";
import { planRemoveNodeItemById } from "./dataPlanner";
import { getDocumentByIdOrFilePath, getDocumentForNode } from "./core/Document";
import { linkSpan, nodeText } from "./core/nodeSpans";
import {
  ViewPath,
  getIndependentRows,
  updateViewPathsAfterDisconnect,
  childViewKey,
  copyViewsWithNewPrefix,
  getPaneRootItemID,
  newGraphNode,
} from "./rowModel";
import { PositionName, embedTargetOf } from "./showings";
import {
  planMaterializeComputedRow,
  planRecordKnowstrSource,
} from "./core/plan";
import { sourceCoordinate } from "./navigationUrl";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";
import { getNodesInDocument, getNodesInTree } from "./treeTraversal";
import {
  AddToParentTarget,
  Plan,
  planAddToParent,
  planDeleteNodes,
  planDeleteDescendantNodes,
  planExpandNode,
  planUpdatePanes,
  planUpdateViews,
  planUpsertNodes,
} from "./planner";

function resetInvalidPanes(plan: Plan, paneIndexToReset?: number): Plan {
  const shouldResetPane = (p: Pane, i: number): boolean => {
    if (paneIndexToReset !== undefined && i === paneIndexToReset) {
      return true;
    }
    if (!p.rootNodeId) {
      return false;
    }
    return getNode(plan.knowledgeDBs, p.rootNodeId, p.sourceId) === undefined;
  };

  const newPanes = plan.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, rootNodeId: undefined } : p
  );
  return planUpdatePanes(plan, newPanes);
}

export function planDisconnectFromParent(
  plan: Plan,
  parentID: ID,
  childID: ID,
  preserveDescendants?: boolean
): Plan {
  const updatedNodesPlan = planRemoveNodeItemById(
    plan,
    parentID,
    childID,
    preserveDescendants === undefined ? false : !!preserveDescendants
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedNodesPlan.views,
    childID,
    parentID
  );

  const planWithViews = planUpdateViews(updatedNodesPlan, updatedViews);

  return resetInvalidPanes(planWithViews);
}

export function planDeleteNode(
  plan: Plan,
  nodeID: ID,
  parentID: ID | undefined,
  paneIndex: number
): Plan {
  if (parentID) {
    return planDisconnectFromParent(plan, parentID, nodeID);
  }

  if (isSearchId(nodeID)) {
    return plan;
  }

  const node = getWorkspaceNode(plan.knowledgeDBs, nodeID);
  if (!node) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantNodes(plan, node);
  const planAfterDelete = planDeleteNodes(planAfterDescendants, node.id);
  return resetInvalidPanes(planAfterDelete, paneIndex);
}

const WRITER_FILTERS: Pane["typeFilters"] = [
  "relevant",
  "maybe_relevant",
  "little_relevant",
  "not_relevant",
  "contains",
];

const POSITION_KEYS = ["after", "before", "parent"];

type SplicedEntry = { row: Row; depth: number };

type ScreenLinks = {
  parent: (number | undefined)[];
  prevSibling: (number | undefined)[];
};

function writerRows(data: Data, paneIndex: number): Row[] {
  const pane = data.panes[paneIndex];
  const rootPath: ViewPath = [paneIndex, getPaneRootItemID(pane)];
  const paneDocument = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        pane.sourceId,
        pane.documentId
      )
    : undefined;
  const { rows } = paneDocument
    ? getNodesInDocument(data, rootPath, paneDocument, WRITER_FILTERS, {
        expandAll: true,
      })
    : getNodesInTree(
        data,
        List<ViewPath>([rootPath]),
        pane.rootNodeId,
        pane.sourceId,
        WRITER_FILTERS,
        { expandAll: true }
      );
  return rows
    .toArray()
    .filter(
      (row) => !isEmptyNodeID(row.node.id) && row.virtualType === undefined
    );
}

function blockEndAt(rows: Row[], start: number): number {
  const startDepth = rows[start].depth;
  const relative = rows
    .slice(start + 1)
    .findIndex((row) => row.depth <= startDepth);
  return relative < 0 ? rows.length : start + 1 + relative;
}

function fileMembershipNode(
  plan: Plan,
  node: GraphNode
): GraphNode | undefined {
  const walk = (
    currentID: ID | undefined,
    visited: ImmutableSet<ID>
  ): GraphNode | undefined => {
    if (currentID === undefined || visited.has(currentID)) {
      return undefined;
    }
    const current = getWorkspaceNode(plan.knowledgeDBs, currentID);
    if (!current) {
      return undefined;
    }
    if (embedTargetOf(current) !== undefined) {
      return current;
    }
    return walk(current.parent, visited.add(currentID));
  };
  return walk(node.parent, ImmutableSet<ID>());
}

// Planned style exception: one linear pass beats the no-mutation lint.
/* eslint-disable functional/no-let, functional/immutable-data */
function screenLinksOf(entries: SplicedEntry[]): ScreenLinks {
  const parent: (number | undefined)[] = [];
  const prevSibling: (number | undefined)[] = [];
  const stack: number[] = [];
  const lastChildOf = new Map<number, number>();
  entries.forEach((entry, index) => {
    while (
      stack.length > 0 &&
      entries[stack[stack.length - 1]].depth >= entry.depth
    ) {
      stack.pop();
    }
    const parentIndex = stack.length > 0 ? stack[stack.length - 1] : -1;
    parent.push(parentIndex >= 0 ? parentIndex : undefined);
    prevSibling.push(lastChildOf.get(parentIndex));
    lastChildOf.set(parentIndex, index);
    stack.push(index);
  });
  return { parent, prevSibling };
}
/* eslint-enable functional/no-let, functional/immutable-data */

type MoveContext = {
  plan: Plan;
  graph: GraphLookup;
  entries: SplicedEntry[];
  links: ScreenLinks;
  lines: (ID | undefined)[];
  hosts: (ID | undefined)[];
};

function moveContextOf(
  plan: Plan,
  graph: GraphLookup,
  entries: SplicedEntry[]
): MoveContext {
  const hostOf = (row: Row): ID | undefined => {
    if (!row.projected) {
      return fileMembershipNode(plan, row.node)?.id;
    }
    if (row.spokenFor === undefined) {
      return row.embeddedIn;
    }
    const statement = getWorkspaceNode(plan.knowledgeDBs, row.spokenFor);
    return statement !== undefined
      ? fileMembershipNode(plan, statement)?.id
      : undefined;
  };
  return {
    plan,
    graph,
    entries,
    links: screenLinksOf(entries),
    lines: entries.map(({ row }) =>
      row.projected ? row.spokenFor : row.node.id
    ),
    hosts: entries.map(({ row }) => hostOf(row)),
  };
}

function hostResolves(context: MoveContext, hostId: ID | undefined): boolean {
  if (hostId === undefined) {
    return false;
  }
  const host = getWorkspaceNode(context.plan.knowledgeDBs, hostId);
  const targetId = host !== undefined ? embedTargetOf(host) : undefined;
  return (
    targetId !== undefined &&
    resolveAuthoredFirst(context.graph, targetId, LOCAL) !== undefined
  );
}

function anchorOf(
  context: MoveContext,
  index: number
): PositionName | undefined {
  const prev = context.links.prevSibling[index];
  if (prev !== undefined) {
    return { kind: "after", id: context.entries[prev].row.node.id };
  }
  const parent = context.links.parent[index];
  return parent !== undefined
    ? { kind: "parent", id: context.entries[parent].row.node.id }
    : undefined;
}

function withAnchorAttrs(
  node: GraphNode,
  anchor: PositionName | undefined
): GraphNode | undefined {
  const kept = Object.entries(node.extraAttrs ?? {}).filter(
    ([key]) => !POSITION_KEYS.includes(key)
  );
  const next: Record<string, string> = {
    ...Object.fromEntries(kept),
    ...(anchor !== undefined && { [anchor.kind]: anchor.id }),
  };
  if (JSON.stringify(next) === JSON.stringify(node.extraAttrs ?? {})) {
    return undefined;
  }
  return {
    ...node,
    extraAttrs: Object.keys(next).length > 0 ? next : undefined,
  };
}

type Updates = ImmutableMap<ID, GraphNode>;

function currentNodeOf(
  plan: Plan,
  updates: Updates,
  id: ID
): GraphNode | undefined {
  return updates.get(id) ?? getWorkspaceNode(plan.knowledgeDBs, id);
}

/* eslint-disable functional/no-let */
function physicalPredecessorOf(
  context: MoveContext,
  index: number
): ID | undefined {
  let at = context.links.prevSibling[index];
  while (at !== undefined) {
    const { row } = context.entries[at];
    if (
      !row.projected &&
      row.positioned !== true &&
      context.hosts[at] === undefined
    ) {
      return row.node.id;
    }
    at = context.links.prevSibling[at];
  }
  return undefined;
}
/* eslint-enable functional/no-let */

function positionHostOf(
  context: MoveContext,
  parentIndex: number
): ID | undefined {
  const parentRow = context.entries[parentIndex].row;
  if (parentRow.projected) {
    return parentRow.embeddedIn;
  }
  if (embedTargetOf(parentRow.node) !== undefined) {
    return parentRow.node.id;
  }
  return context.hosts[parentIndex];
}

function dropAllowed(context: MoveContext, index: number): boolean {
  const { row } = context.entries[index];
  if (row.projected) {
    if (row.embeddedIn === undefined) {
      return false;
    }
    return context.lines[index] === undefined
      ? hostResolves(context, row.embeddedIn)
      : hostResolves(context, context.hosts[index]);
  }
  if (context.hosts[index] !== undefined) {
    return hostResolves(context, context.hosts[index]);
  }
  if (row.positioned === true) {
    return true;
  }
  const parentIndex = context.links.parent[index];
  const node = getWorkspaceNode(context.plan.knowledgeDBs, row.node.id);
  if (parentIndex === undefined || !node || node.parent === undefined) {
    return false;
  }
  const hostId = positionHostOf(context, parentIndex);
  return hostId === undefined || hostResolves(context, hostId);
}

function movesFor(
  context: MoveContext,
  index: number
): { node: GraphNode; to: ID; at: { after: ID | undefined } | "end" }[] {
  const { row } = context.entries[index];
  if (row.projected) {
    if (context.lines[index] !== undefined || row.embeddedIn === undefined) {
      return [];
    }
    const host = getWorkspaceNode(context.plan.knowledgeDBs, row.embeddedIn);
    if (!host) {
      return [];
    }
    const anchor = anchorOf(context, index);
    const statement: GraphNode = {
      ...newGraphNode([linkSpan(row.node.id, nodeText(row.node))], {
        root: host.root,
        parent: host.id,
      }),
      extraAttrs: {
        embed: "true",
        ...(anchor !== undefined && { [anchor.kind]: anchor.id }),
      },
    };
    return [{ node: statement, to: host.id, at: "end" }];
  }
  if (context.hosts[index] !== undefined || row.positioned === true) {
    return [];
  }
  const node = getWorkspaceNode(context.plan.knowledgeDBs, row.node.id);
  const parentIndex = context.links.parent[index];
  if (!node || parentIndex === undefined) {
    return [];
  }
  const hostId = positionHostOf(context, parentIndex);
  return hostId === undefined
    ? [
        {
          node,
          to: context.entries[parentIndex].row.node.id,
          at: { after: physicalPredecessorOf(context, index) },
        },
      ]
    : [{ node, to: hostId, at: "end" }];
}

function claimsAnchor(context: MoveContext, index: number): boolean {
  const { row } = context.entries[index];
  if (row.projected) {
    return context.lines[index] !== undefined;
  }
  if (context.hosts[index] !== undefined || row.positioned === true) {
    return true;
  }
  const parentIndex = context.links.parent[index];
  return (
    parentIndex !== undefined &&
    positionHostOf(context, parentIndex) !== undefined
  );
}

function applyMove(
  plan: Plan,
  updates: Updates,
  move: { node: GraphNode; to: ID; at: { after: ID | undefined } | "end" }
): Updates {
  const node = currentNodeOf(plan, updates, move.node.id) ?? move.node;
  const from =
    node.parent !== undefined
      ? currentNodeOf(plan, updates, node.parent)
      : undefined;
  const removed = from
    ? updates.set(from.id, {
        ...from,
        children: from.children.filter((childId) => childId !== node.id),
      })
    : updates;
  const to = currentNodeOf(plan, removed, move.to);
  if (!to) {
    return updates;
  }
  const insertAt = ((): number => {
    if (move.at === "end") {
      return to.children.size;
    }
    if (move.at.after === undefined) {
      return 0;
    }
    return to.children.indexOf(move.at.after) + 1;
  })();
  return removed
    .set(to.id, { ...to, children: to.children.insert(insertAt, node.id) })
    .set(node.id, { ...node, parent: to.id });
}

function deriveAnchors(
  context: MoveContext,
  updates: Updates,
  grabbedRows: ImmutableSet<Row>,
  anchored: ImmutableSet<number>
): Updates {
  return context.entries.reduce((acc, { row }, index) => {
    const grabbedClaim = anchored.has(index);
    const standingClaim =
      !grabbedRows.has(row) &&
      row.positioned === true &&
      !row.lapsed &&
      !row.ambiguous &&
      (!row.projected || context.hosts[index] !== undefined) &&
      (context.hosts[index] === undefined ||
        hostResolves(context, context.hosts[index]));
    if (!grabbedClaim && !standingClaim) {
      return acc;
    }
    const anchor = anchorOf(context, index);
    const lineId = context.lines[index];
    const line =
      lineId !== undefined
        ? currentNodeOf(context.plan, acc, lineId)
        : undefined;
    const updated =
      line !== undefined ? withAnchorAttrs(line, anchor) : undefined;
    return updated !== undefined ? acc.set(updated.id, updated) : acc;
  }, updates);
}

function remapPaneKey(viewKey: string, paneIndex: number): string {
  return viewKey.replace(/^p\d+:/u, `p${paneIndex}:`);
}

function spliceRows(
  rows: Row[],
  grabbed: Row[],
  insertBefore: Row | undefined,
  indent: number,
  paneIndex: number
): { entries: SplicedEntry[]; grabbedRows: ImmutableSet<Row> } | undefined {
  const indexOfKey = new Map(rows.map((row, i) => [row.viewKey, i] as const));
  const requested = grabbed.flatMap((row) => {
    const at = indexOfKey.get(remapPaneKey(row.viewKey, paneIndex));
    return at === undefined ? [] : [at];
  });
  if (requested.length < grabbed.length) {
    return undefined;
  }
  const blocks = ImmutableSet(requested)
    .sort()
    .toArray()
    .reduce<{ start: number; end: number }[]>((acc, start) => {
      const last = acc[acc.length - 1];
      return last && start < last.end
        ? acc
        : [...acc, { start, end: blockEndAt(rows, start) }];
    }, []);
  if (
    blocks.length === 0 ||
    blocks.some(({ start }) => rows[start].parentRef === undefined)
  ) {
    return undefined;
  }
  const inBlocks = ImmutableSet(
    blocks.flatMap(({ start, end }) =>
      Array.from({ length: end - start }, (ignored, offset) => start + offset)
    )
  );
  const remaining = rows.filter((ignored, index) => !inBlocks.has(index));
  const insertAt =
    insertBefore === undefined
      ? remaining.length
      : remaining.findIndex(
          (row) => row.viewKey === remapPaneKey(insertBefore.viewKey, paneIndex)
        );
  if (insertAt < 0) {
    return undefined;
  }
  const grabbedEntries = blocks.flatMap(({ start, end }) => {
    const delta = indent - rows[start].depth;
    return rows
      .slice(start, end)
      .map((row): SplicedEntry => ({ row, depth: row.depth + delta }));
  });
  const entries: SplicedEntry[] = [
    ...remaining
      .slice(0, insertAt)
      .map((row): SplicedEntry => ({ row, depth: row.depth })),
    ...grabbedEntries,
    ...remaining
      .slice(insertAt)
      .map((row): SplicedEntry => ({ row, depth: row.depth })),
  ];
  return {
    entries,
    grabbedRows: ImmutableSet(blocks.map(({ start }) => rows[start])),
  };
}

export function planMoveRows(
  plan: Plan,
  data: Data,
  paneIndex: number,
  grabbed: Row[],
  insertBefore: Row | undefined,
  indent: number
): Plan | undefined {
  const rows = writerRows(data, paneIndex);
  const spliced = spliceRows(rows, grabbed, insertBefore, indent, paneIndex);
  if (spliced === undefined) {
    return undefined;
  }
  const { entries, grabbedRows } = spliced;
  const context = moveContextOf(plan, graphLookupFromData(data), entries);
  const rootIndexes = entries.flatMap((entry, index) =>
    grabbedRows.has(entry.row) ? [index] : []
  );
  if (!rootIndexes.every((index) => dropAllowed(context, index))) {
    return undefined;
  }
  const moved = rootIndexes
    .flatMap((index) => movesFor(context, index))
    .reduce<Updates>(
      (updates, move) => applyMove(plan, updates, move),
      ImmutableMap<ID, GraphNode>()
    );
  const anchored = ImmutableSet(
    rootIndexes.filter((index) => claimsAnchor(context, index))
  );
  const derived = deriveAnchors(context, moved, grabbedRows, anchored);
  const written = derived
    .valueSeq()
    .reduce((acc, node) => planUpsertNodes(acc, node), plan);
  return rootIndexes.reduce((acc, index) => {
    const { row } = entries[index];
    const parentIndex = context.links.parent[index];
    if (parentIndex === undefined) {
      return acc;
    }
    const parentRow = entries[parentIndex].row;
    const expanded = planExpandNode(acc, parentRow.view, parentRow.viewPath);
    const newKey = childViewKey(parentRow.viewKey, row.node.id);
    if (newKey === row.viewKey) {
      return expanded;
    }
    return planUpdateViews(
      expanded,
      copyViewsWithNewPrefix(expanded.views, row.viewKey, newKey)
    );
  }, written);
}

function getCurrentWorkspaceNode(plan: Plan, node: GraphNode): GraphNode {
  return getNode(plan.knowledgeDBs, node.id, LOCAL) ?? node;
}

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

// Dragging a row from another user's document records that document in
// knowstr_sources of ours — the one moment the source is known for
// certain, so foreign ids resolve on a future fetch.
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

export function planAddRows(
  basePlan: Plan,
  sourceDrag: {
    row: Row;
    draggedRows: Row[];
    sourcePaneIndex: number;
    text?: string;
    isCopyDrag?: boolean;
    nodeId?: ID;
    insertTarget?: AddToParentTarget;
  },
  targetPaneIndex: number,
  targetParentRow: Row,
  dropIndex: number
): Plan {
  const source = sourceDrag.row.viewKey;
  const sources = sourceDrag.draggedRows.length
    ? sourceDrag.draggedRows
    : [sourceDrag.row];
  const independentRows = getIndependentRows(sources);
  if (targetParentRow.projected) {
    return basePlan;
  }
  const [plan, targetParentNode] = planMaterializeComputedRow(
    basePlan,
    targetParentRow
  );

  const sourcePane = plan.panes[sourceDrag.sourcePaneIndex];
  const targetPane = plan.panes[targetPaneIndex];
  if (!sourcePane || !targetPane) {
    return plan;
  }
  const sourceDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    sourceDrag.row.node,
    sourceDrag.row.sourceId
  );
  const targetSourceId = targetParentRow.materialize
    ? LOCAL
    : targetParentRow.sourceId;
  const targetDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    targetParentNode,
    targetSourceId
  );
  const isSameDocument =
    sourceDocument !== undefined &&
    targetDocument !== undefined &&
    sourceDocument.sourceId === targetDocument.sourceId &&
    sourceDocument.docId === targetDocument.docId;
  const isDocumentTopLevelSource =
    sourceDocument !== undefined &&
    sourceDocument.sourceId === sourceDrag.row.sourceId &&
    sourceDocument.topNodeShortIds.includes(sourceDrag.row.node.id);

  if (isDocumentTopLevelSource && isSameDocument && !sourceDrag.isCopyDrag) {
    return plan;
  }

  const expandedPlan = targetParentRow.view.expanded
    ? plan
    : planExpandNode(plan, targetParentRow.view, targetParentRow.viewPath);

  const toReferenceTarget = (sourceRow: Row): AddToParentTarget =>
    createRefTarget(sourceRow.node.id, nodeText(sourceRow.node));

  return independentRows.reduce((accPlan: Plan, sourceRow, idx) => {
    const sourceNode = sourceRow.node;
    const sourceEdgeRelevance = sourceNode.relevance;
    const sourceEdgeArgument = sourceNode.argument;
    const insertAt = dropIndex + idx;
    const isPrimarySource = sourceRow.viewKey === source;
    const targetNode = getCurrentWorkspaceNode(accPlan, targetParentNode);
    const planWithSource =
      targetSourceId === LOCAL
        ? planRecordForeignSource(accPlan, sourcePane, sourceRow, targetNode)
        : accPlan;
    const insertTarget =
      sourceRow.materialize?.take ??
      (isPrimarySource ? sourceDrag.insertTarget : undefined);
    const dragTargetID = isPrimarySource ? sourceDrag.nodeId : undefined;
    if (insertTarget) {
      return planAddToParent(
        planWithSource,
        addFallbackLinkText(insertTarget, sourceDrag.text),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    if (dragTargetID) {
      return planAddToParent(
        planWithSource,
        createRefTarget(dragTargetID, nodeText(sourceNode)),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    return planAddToParent(
      planWithSource,
      toReferenceTarget(sourceRow),
      targetNode.id,
      insertAt,
      sourceEdgeRelevance,
      sourceEdgeArgument
    )[0];
  }, expandedPlan);
}
