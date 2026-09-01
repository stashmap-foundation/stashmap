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
  addNodeToPathWithNodes,
  addNodesToLastElement,
  viewPathToString,
  childViewKey,
  copyViewsWithNewPrefix,
  getPaneRootItemID,
  newGraphNode,
} from "./rowModel";
import { embedTargetOf } from "./showings";
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
  planMoveDescendantNodes,
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

function planMoveNode(
  plan: Plan,
  sourceNodeID: ID,
  sourceChildID: ID,
  sourceParentID: ID,
  sourceViewPath: ViewPath,
  targetParentID: ID,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number
): Plan {
  const sourceNode = getWorkspaceNode(plan.knowledgeDBs, sourceNodeID);
  if (!sourceNode) {
    return plan;
  }

  const [planWithAdd] = planAddToParent(
    plan,
    sourceNodeID,
    targetParentID,
    insertAtIndex
  );

  const actualTargetParentNode = getWorkspaceNode(
    planWithAdd.knowledgeDBs,
    targetParentID
  );

  if (!actualTargetParentNode || actualTargetParentNode.children.size === 0) {
    return planDisconnectFromParent(
      planWithAdd,
      sourceParentID,
      sourceChildID,
      true
    );
  }

  const targetIndex = insertAtIndex ?? actualTargetParentNode.children.size - 1;
  const targetViewPath = addNodeToPathWithNodes(
    targetParentViewPath,
    actualTargetParentNode,
    targetIndex
  );

  const sourceKey = viewPathToString(sourceViewPath);
  const targetKey = viewPathToString(targetViewPath);
  const preservedSourceViews =
    sourceKey === targetKey
      ? planWithAdd.views.filter(
          (_view, key) => key === sourceKey || key.startsWith(`${sourceKey}:`)
        )
      : undefined;
  const updatedViews = copyViewsWithNewPrefix(
    planWithAdd.views,
    sourceKey,
    targetKey
  );
  const planWithViews = planUpdateViews(planWithAdd, updatedViews);

  const disconnectedPlan = planDisconnectFromParent(
    planWithViews,
    sourceParentID,
    sourceChildID,
    true
  );
  const planWithDisconnect =
    preservedSourceViews && preservedSourceViews.size > 0
      ? planUpdateViews(
          disconnectedPlan,
          disconnectedPlan.views.merge(preservedSourceViews)
        )
      : disconnectedPlan;

  return planMoveDescendantNodes(
    planWithDisconnect,
    sourceNode,
    actualTargetParentNode.id,
    actualTargetParentNode.root
  );
}

export function planMoveRowsIntoMaterializedRow(
  plan: Plan,
  sortedRows: Row[],
  prevSibling: Row
): { plan: Plan; remappedKeys: { fromKey: string; toKey: string }[] } {
  const [planMaterialized, takenPrevSibling] = planMaterializeComputedRow(
    plan,
    prevSibling
  );
  const takenViewPath = addNodesToLastElement(
    prevSibling.viewPath,
    takenPrevSibling.id
  );
  const currentTaken = (current: Plan): GraphNode =>
    getNode(current.knowledgeDBs, takenPrevSibling.id, LOCAL) ??
    takenPrevSibling;
  return sortedRows.reduce<{
    plan: Plan;
    remappedKeys: { fromKey: string; toKey: string }[];
  }>(
    (state, row) => {
      if (!row.parentNode) {
        return state;
      }
      const targetBefore = currentTaken(state.plan);
      const insertAt = targetBefore.children.size;
      const moved = planMoveNode(
        state.plan,
        row.node.id,
        row.node.id,
        row.parentNode.id,
        row.viewPath,
        targetBefore.id,
        takenViewPath,
        insertAt
      );
      const targetAfter = currentTaken(moved);
      const movedViewPath =
        insertAt < targetAfter.children.size
          ? addNodeToPathWithNodes(takenViewPath, targetAfter, insertAt)
          : undefined;
      return {
        plan: moved,
        remappedKeys: movedViewPath
          ? [
              ...state.remappedKeys,
              { fromKey: row.viewKey, toKey: viewPathToString(movedViewPath) },
            ]
          : state.remappedKeys,
      };
    },
    {
      plan: planExpandNode(planMaterialized, prevSibling.view, takenViewPath),
      remappedKeys: [],
    }
  );
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
  parent: (SplicedEntry | undefined)[];
  prevSibling: (SplicedEntry | undefined)[];
  nextSibling: (SplicedEntry | undefined)[];
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
  const parent: (SplicedEntry | undefined)[] = [];
  const prevSibling: (SplicedEntry | undefined)[] = [];
  const nextSibling: (SplicedEntry | undefined)[] = [];
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
    const previous = lastChildOf.get(parentIndex);
    parent.push(parentIndex >= 0 ? entries[parentIndex] : undefined);
    prevSibling.push(previous !== undefined ? entries[previous] : undefined);
    nextSibling.push(undefined);
    if (previous !== undefined) {
      nextSibling[previous] = entry;
    }
    lastChildOf.set(parentIndex, index);
    stack.push(index);
  });
  return { parent, prevSibling, nextSibling };
}
/* eslint-enable functional/no-let, functional/immutable-data */

function ladderOf(
  links: ScreenLinks,
  index: number,
  membershipNodeId: ID | undefined
): { after?: ID; before?: ID; parent?: ID } {
  const after = links.prevSibling[index]?.row.node.id;
  const before = links.nextSibling[index]?.row.node.id;
  const parentId = links.parent[index]?.row.node.id;
  if (after === undefined && before === undefined) {
    return parentId !== undefined ? { parent: parentId } : {};
  }
  return {
    ...(after !== undefined && { after }),
    ...(before !== undefined && { before }),
    ...(parentId !== undefined &&
      parentId !== membershipNodeId && { parent: parentId }),
  };
}

function withLadderAttrs(
  node: GraphNode,
  ladder: { after?: ID; before?: ID; parent?: ID }
): GraphNode | undefined {
  const kept = Object.entries(node.extraAttrs ?? {}).filter(
    ([key]) => !POSITION_KEYS.includes(key)
  );
  const next: Record<string, string> = {
    ...Object.fromEntries(kept),
    ...(ladder.after !== undefined && { after: ladder.after }),
    ...(ladder.before !== undefined && { before: ladder.before }),
    ...(ladder.parent !== undefined && { parent: ladder.parent }),
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

function withLadder(
  updates: Updates,
  node: GraphNode,
  ladder: { after?: ID; before?: ID; parent?: ID }
): Updates {
  const updated = withLadderAttrs(node, ladder);
  return updated ? updates.set(updated.id, updated) : updates;
}

function detachLine(
  plan: Plan,
  updates: Updates,
  node: GraphNode
): Updates | undefined {
  const oldParent =
    node.parent !== undefined
      ? currentNodeOf(plan, updates, node.parent)
      : undefined;
  if (!oldParent) {
    return undefined;
  }
  return updates.set(oldParent.id, {
    ...oldParent,
    children: oldParent.children.filter((childId) => childId !== node.id),
  });
}

function attachLine(
  plan: Plan,
  updates: Updates,
  nodeId: ID,
  parentId: ID,
  anchor: { after: ID | undefined } | "end"
): Updates | undefined {
  const parent = currentNodeOf(plan, updates, parentId);
  const node = currentNodeOf(plan, updates, nodeId);
  if (!parent || !node) {
    return undefined;
  }
  const insertAt = ((): number => {
    if (anchor === "end") {
      return parent.children.size;
    }
    const at =
      anchor.after !== undefined ? parent.children.indexOf(anchor.after) : -1;
    return at >= 0 ? at + 1 : 0;
  })();
  const withParent = updates.set(parentId, {
    ...parent,
    children: parent.children.insert(insertAt, nodeId),
  });
  return node.parent !== parentId
    ? withParent.set(nodeId, { ...node, parent: parentId })
    : withParent;
}

function embedResolves(graph: GraphLookup, embedNode: GraphNode): boolean {
  const targetId = embedTargetOf(embedNode);
  return (
    targetId !== undefined &&
    resolveAuthoredFirst(graph, targetId, LOCAL) !== undefined
  );
}

type MoveContext = {
  plan: Plan;
  graph: GraphLookup;
  entries: SplicedEntry[];
  links: ScreenLinks;
};

function physicalAnchorId(context: MoveContext, index: number): ID | undefined {
  const previous = context.links.prevSibling[index];
  if (!previous) {
    return undefined;
  }
  const { row } = previous;
  if (
    !row.projected &&
    row.positioned !== true &&
    fileMembershipNode(context.plan, row.node) === undefined
  ) {
    return row.node.id;
  }
  return physicalAnchorId(context, context.entries.indexOf(previous));
}

function moveProjectedRow(
  context: MoveContext,
  updates: Updates,
  index: number
): Updates | undefined {
  const { row } = context.entries[index];
  if (row.embeddedIn === undefined) {
    return undefined;
  }
  const ladder = ladderOf(context.links, index, row.embeddedIn);
  if (row.spokenFor !== undefined) {
    const statement = currentNodeOf(context.plan, updates, row.spokenFor);
    if (!statement) {
      return undefined;
    }
    const membership = fileMembershipNode(context.plan, statement);
    if (!membership || !embedResolves(context.graph, membership)) {
      return undefined;
    }
    return withLadder(updates, statement, ladder);
  }
  const host = currentNodeOf(context.plan, updates, row.embeddedIn);
  if (!host || !embedResolves(context.graph, host)) {
    return undefined;
  }
  const statementNode: GraphNode = {
    ...newGraphNode([linkSpan(row.node.id, nodeText(row.node))], {
      root: host.root,
      parent: host.id,
    }),
    extraAttrs: {
      embed: "true",
      ...(ladder.after !== undefined && { after: ladder.after }),
      ...(ladder.before !== undefined && { before: ladder.before }),
      ...(ladder.parent !== undefined && { parent: ladder.parent }),
    },
  };
  return attachLine(
    context.plan,
    updates.set(statementNode.id, statementNode),
    statementNode.id,
    host.id,
    "end"
  );
}

function moveOwnLineRow(
  context: MoveContext,
  updates: Updates,
  index: number
): Updates | undefined {
  const { row } = context.entries[index];
  const node = currentNodeOf(context.plan, updates, row.node.id);
  if (!node) {
    return undefined;
  }
  const membership = fileMembershipNode(context.plan, node);
  if (membership && !embedResolves(context.graph, membership)) {
    return undefined;
  }
  return withLadder(
    updates,
    node,
    ladderOf(context.links, index, membership?.id)
  );
}

function governingHostId(context: MoveContext, parentRow: Row): ID | undefined {
  if (parentRow.projected) {
    return parentRow.embeddedIn;
  }
  if (embedTargetOf(parentRow.node) !== undefined) {
    return parentRow.node.id;
  }
  return fileMembershipNode(context.plan, parentRow.node)?.id;
}

function moveHomeRow(
  context: MoveContext,
  updates: Updates,
  index: number
): Updates | undefined {
  const parentEntry = context.links.parent[index];
  if (!parentEntry) {
    return undefined;
  }
  const node = currentNodeOf(
    context.plan,
    updates,
    context.entries[index].row.node.id
  );
  if (!node) {
    return undefined;
  }
  const hostId = governingHostId(context, parentEntry.row);
  if (hostId === undefined) {
    const detached = detachLine(context.plan, updates, node);
    return detached
      ? attachLine(context.plan, detached, node.id, parentEntry.row.node.id, {
          after: physicalAnchorId(context, index),
        })
      : undefined;
  }
  const host = currentNodeOf(context.plan, updates, hostId);
  if (!host || !embedResolves(context.graph, host)) {
    return undefined;
  }
  const detached = detachLine(context.plan, updates, node);
  if (!detached) {
    return undefined;
  }
  const attached = attachLine(context.plan, detached, node.id, host.id, "end");
  if (!attached) {
    return undefined;
  }
  const moved = currentNodeOf(context.plan, attached, node.id);
  return moved
    ? withLadder(attached, moved, ladderOf(context.links, index, host.id))
    : attached;
}

function moveGrabbedRow(
  context: MoveContext,
  updates: Updates,
  index: number
): Updates | undefined {
  const { row } = context.entries[index];
  if (row.projected) {
    return moveProjectedRow(context, updates, index);
  }
  const membership = fileMembershipNode(context.plan, row.node);
  if (membership !== undefined || row.positioned === true) {
    return moveOwnLineRow(context, updates, index);
  }
  return moveHomeRow(context, updates, index);
}

function hasPositionNames(node: GraphNode): boolean {
  return Object.keys(node.extraAttrs ?? {}).some((key) =>
    POSITION_KEYS.includes(key)
  );
}

function repairEntry(
  context: MoveContext,
  updates: Updates,
  index: number,
  grabbedRoots: ImmutableSet<Row>
): Updates {
  const { row } = context.entries[index];
  if (
    grabbedRoots.has(row) ||
    row.lapsed ||
    row.ambiguous ||
    row.positioned !== true
  ) {
    return updates;
  }
  if (!row.projected) {
    const node = currentNodeOf(context.plan, updates, row.node.id);
    if (!node || !hasPositionNames(node)) {
      return updates;
    }
    const membership = fileMembershipNode(context.plan, node);
    if (membership && !embedResolves(context.graph, membership)) {
      return updates;
    }
    return withLadder(
      updates,
      node,
      ladderOf(context.links, index, membership?.id)
    );
  }
  if (row.spokenFor === undefined) {
    return updates;
  }
  const statement = currentNodeOf(context.plan, updates, row.spokenFor);
  if (!statement) {
    return updates;
  }
  const membership = fileMembershipNode(context.plan, statement);
  if (!membership || !embedResolves(context.graph, membership)) {
    return updates;
  }
  return withLadder(
    updates,
    statement,
    ladderOf(context.links, index, membership.id)
  );
}

function remapPaneKey(viewKey: string, paneIndex: number): string {
  return viewKey.replace(/^p\d+:/u, `p${paneIndex}:`);
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
  const indexOfKey = new Map(rows.map((row, i) => [row.viewKey, i] as const));
  const requested = grabbed.flatMap((row) => {
    const at = indexOfKey.get(remapPaneKey(row.viewKey, paneIndex));
    return at === undefined ? [] : [at];
  });
  if (requested.length < grabbed.length) {
    return undefined;
  }
  const sorted = ImmutableSet(requested).sort().toArray();
  const blocks = sorted.reduce<{ start: number; end: number }[]>(
    (acc, start) => {
      const last = acc[acc.length - 1];
      if (last && start < last.end) {
        return acc;
      }
      return [...acc, { start, end: blockEndAt(rows, start) }];
    },
    []
  );
  if (blocks.length === 0) {
    return undefined;
  }
  const refused = blocks.some(
    ({ start }) => rows[start].parentRef === undefined
  );
  if (refused) {
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
  const context: MoveContext = {
    plan,
    graph: graphLookupFromData(data),
    entries,
    links: screenLinksOf(entries),
  };
  const grabbedRows = ImmutableSet(blocks.map(({ start }) => rows[start]));
  const rootIndexes = entries.flatMap((entry, index) =>
    grabbedRows.has(entry.row) ? [index] : []
  );
  const staged = rootIndexes.reduce<Updates | undefined>(
    (updates, index) =>
      updates === undefined
        ? undefined
        : moveGrabbedRow(context, updates, index),
    ImmutableMap<ID, GraphNode>()
  );
  if (staged === undefined) {
    return undefined;
  }
  const repaired = context.entries.reduce(
    (updates, ignored, index) =>
      repairEntry(context, updates, index, grabbedRows),
    staged
  );
  const written = repaired
    .valueSeq()
    .reduce((acc, node) => planUpsertNodes(acc, node), plan);
  return rootIndexes.reduce((acc, index) => {
    const { row } = entries[index];
    const parentEntry = context.links.parent[index];
    if (!parentEntry) {
      return acc;
    }
    const expanded = planExpandNode(
      acc,
      parentEntry.row.view,
      parentEntry.row.viewPath
    );
    const newKey = childViewKey(parentEntry.row.viewKey, row.node.id);
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
  if (
    targetParentRow.projected ||
    independentRows.some((row) => row.projected)
  ) {
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
