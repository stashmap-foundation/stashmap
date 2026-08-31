import { List } from "immutable";
import { getNode, isEmptyNodeID, isSearchId } from "./core/connections";
import { LOCAL } from "./core/nodeRef";
import {
  GraphLookup,
  graphLookupFromData,
  resolveAuthoredFirst,
} from "./core/graphLookup";
import { getWorkspaceNode } from "./core/knowledge";
import { planRemoveNodeItemById } from "./dataPlanner";
import { getDocumentByIdOrFilePath } from "./core/Document";
import { linkSpan, nodeText } from "./core/nodeSpans";
import {
  ViewPath,
  updateViewPathsAfterDisconnect,
  addNodeToPathWithNodes,
  viewPathToString,
  childViewKey,
  copyViewsWithNewPrefix,
  getPaneRootItemID,
  newGraphNode,
} from "./rowModel";
import { embedTargetOf } from "./showings";
import { getNodesInDocument, getNodesInTree } from "./treeTraversal";
import {
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

export function planMoveNode(
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
  return rows.toArray().filter((row) => !isEmptyNodeID(row.node.id));
}

function blockEndAt(rows: Row[], start: number): number {
  const startDepth = rows[start].depth;
  const relative = rows
    .slice(start + 1)
    .findIndex((row) => row.depth <= startDepth);
  return relative < 0 ? rows.length : start + 1 + relative;
}

function hostEmbedRowOf(rows: Row[], index: number): Row | undefined {
  const walk = (at: number, depth: number): Row | undefined => {
    if (at < 0) {
      return undefined;
    }
    const candidate = rows[at];
    if (candidate.depth >= depth) {
      return walk(at - 1, depth);
    }
    return candidate.projected ? walk(at - 1, candidate.depth) : candidate;
  };
  return walk(index - 1, rows[index].depth);
}

function fileMembershipNode(
  plan: Plan,
  node: GraphNode
): GraphNode | undefined {
  const walk = (
    currentID: ID | undefined,
    visited: Set<ID>
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
  return walk(node.parent, new Set<ID>());
}

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
    parent[index] = parentIndex >= 0 ? entries[parentIndex] : undefined;
    const previous = lastChildOf.get(parentIndex);
    prevSibling[index] = previous !== undefined ? entries[previous] : undefined;
    nextSibling[index] = undefined;
    if (previous !== undefined) {
      nextSibling[previous] = entry;
    }
    lastChildOf.set(parentIndex, index);
    stack.push(index);
  });
  return { parent, prevSibling, nextSibling };
}
/* eslint-enable functional/no-let, functional/immutable-data */

function screenAncestorEmbed(
  links: ScreenLinks,
  entries: SplicedEntry[],
  index: number
): Row | undefined {
  const parentEntry = links.parent[index];
  if (!parentEntry) {
    return undefined;
  }
  const parentIndex = entries.indexOf(parentEntry);
  if (
    !parentEntry.row.projected &&
    embedTargetOf(parentEntry.row.node) !== undefined
  ) {
    return parentEntry.row;
  }
  return screenAncestorEmbed(links, entries, parentIndex);
}

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

type MoveContext = {
  entries: SplicedEntry[];
  links: ScreenLinks;
  graph: GraphLookup;
  updates: Map<ID, GraphNode>;
};

/* eslint-disable functional/immutable-data */
function currentNodeOf(
  plan: Plan,
  updates: Map<ID, GraphNode>,
  id: ID
): GraphNode | undefined {
  return updates.get(id) ?? getWorkspaceNode(plan.knowledgeDBs, id);
}

function stageNode(updates: Map<ID, GraphNode>, node: GraphNode): void {
  updates.set(node.id, node);
}

function stageLadder(
  updates: Map<ID, GraphNode>,
  node: GraphNode,
  ladder: { after?: ID; before?: ID; parent?: ID }
): void {
  const updated = withLadderAttrs(node, ladder);
  if (updated) {
    stageNode(updates, updated);
  }
}

function moveGrabbedProjected(
  plan: Plan,
  context: MoveContext,
  index: number,
  hostEmbed: GraphNode
): boolean {
  const { row } = context.entries[index];
  const ladder = ladderOf(context.links, index, hostEmbed.id);
  if (row.spokenFor !== undefined) {
    const statement = currentNodeOf(plan, context.updates, row.spokenFor);
    if (!statement) {
      return false;
    }
    stageLadder(context.updates, statement, ladder);
    return true;
  }
  const embedNode = currentNodeOf(plan, context.updates, hostEmbed.id);
  if (!embedNode) {
    return false;
  }
  const statementNode: GraphNode = {
    ...newGraphNode([linkSpan(row.node.id, nodeText(row.node))], {
      root: embedNode.root,
      parent: embedNode.id,
    }),
    extraAttrs: {
      embed: "true",
      ...(ladder.after !== undefined && { after: ladder.after }),
      ...(ladder.before !== undefined && { before: ladder.before }),
      ...(ladder.parent !== undefined && { parent: ladder.parent }),
    },
  };
  stageNode(context.updates, statementNode);
  stageNode(context.updates, {
    ...embedNode,
    children: embedNode.children.push(statementNode.id),
  });
  return true;
}

function previousOwnSiblingId(
  context: MoveContext,
  index: number
): ID | undefined {
  const previous = context.links.prevSibling[index];
  if (!previous) {
    return undefined;
  }
  if (!previous.row.projected) {
    return previous.row.node.id;
  }
  return previousOwnSiblingId(context, context.entries.indexOf(previous));
}

function moveOwnLine(
  plan: Plan,
  context: MoveContext,
  index: number,
  newParentId: ID
): boolean {
  const { row } = context.entries[index];
  const node = currentNodeOf(plan, context.updates, row.node.id);
  const oldParentId = node?.parent;
  if (!node || oldParentId === undefined) {
    return false;
  }
  const oldParent = currentNodeOf(plan, context.updates, oldParentId);
  if (!oldParent) {
    return false;
  }
  stageNode(context.updates, {
    ...oldParent,
    children: oldParent.children.filter((childId) => childId !== node.id),
  });
  const newParent = currentNodeOf(plan, context.updates, newParentId);
  if (!newParent) {
    return false;
  }
  const previousId = previousOwnSiblingId(context, index);
  const anchorIndex =
    previousId !== undefined ? newParent.children.indexOf(previousId) : -1;
  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : 0;
  stageNode(context.updates, {
    ...newParent,
    children: newParent.children.insert(insertAt, node.id),
  });
  const moved = currentNodeOf(plan, context.updates, node.id);
  if (moved && moved.parent !== newParentId) {
    stageNode(context.updates, { ...moved, parent: newParentId });
  }
  return true;
}

function moveGrabbedHome(
  plan: Plan,
  context: MoveContext,
  index: number
): boolean {
  const parentEntry = context.links.parent[index];
  if (!parentEntry) {
    return false;
  }
  const parentRow = parentEntry.row;
  if (!parentRow.projected && embedTargetOf(parentRow.node) === undefined) {
    return moveOwnLine(plan, context, index, parentRow.node.id);
  }
  const governing = screenAncestorEmbed(context.links, context.entries, index);
  if (!governing || governing.dangling) {
    return false;
  }
  const governingNode = currentNodeOf(plan, context.updates, governing.node.id);
  const { row } = context.entries[index];
  const node = currentNodeOf(plan, context.updates, row.node.id);
  const oldParentId = node?.parent;
  if (!governingNode || !node || oldParentId === undefined) {
    return false;
  }
  const oldParent = currentNodeOf(plan, context.updates, oldParentId);
  if (!oldParent) {
    return false;
  }
  stageNode(context.updates, {
    ...oldParent,
    children: oldParent.children.filter((childId) => childId !== node.id),
  });
  const governingAfterRemove = currentNodeOf(
    plan,
    context.updates,
    governing.node.id
  );
  if (!governingAfterRemove) {
    return false;
  }
  stageNode(context.updates, {
    ...governingAfterRemove,
    children: governingAfterRemove.children.push(node.id),
  });
  const moved = currentNodeOf(plan, context.updates, node.id);
  if (moved) {
    stageLadder(
      context.updates,
      { ...moved, parent: governing.node.id },
      ladderOf(context.links, index, governing.node.id)
    );
    const staged = context.updates.get(node.id);
    if (!staged || staged.parent !== governing.node.id) {
      stageNode(context.updates, {
        ...(staged ?? moved),
        parent: governing.node.id,
      });
    }
  }
  return true;
}

function embedResolves(graph: GraphLookup, embedNode: GraphNode): boolean {
  const targetId = embedTargetOf(embedNode);
  return (
    targetId !== undefined &&
    resolveAuthoredFirst(graph, targetId, LOCAL) !== undefined
  );
}

function repairPositionedEntry(
  plan: Plan,
  context: MoveContext,
  index: number,
  grabbedRoots: Set<Row>
): void {
  const { row } = context.entries[index];
  if (grabbedRoots.has(row) || row.lapsed) {
    return;
  }
  if (!row.projected) {
    const node = currentNodeOf(plan, context.updates, row.node.id);
    if (
      !node ||
      !Object.keys(node.extraAttrs ?? {}).some((key) =>
        POSITION_KEYS.includes(key)
      )
    ) {
      return;
    }
    const membership = fileMembershipNode(plan, node);
    if (membership && !embedResolves(context.graph, membership)) {
      return;
    }
    stageLadder(
      context.updates,
      node,
      ladderOf(context.links, index, membership?.id)
    );
    return;
  }
  if (row.spokenFor === undefined || row.positioned !== true) {
    return;
  }
  const statement = currentNodeOf(plan, context.updates, row.spokenFor);
  if (!statement) {
    return;
  }
  const membership = fileMembershipNode(plan, statement);
  if (!membership || !embedResolves(context.graph, membership)) {
    return;
  }
  stageLadder(
    context.updates,
    statement,
    ladderOf(context.links, index, membership.id)
  );
}

export function planMoveRows(
  plan: Plan,
  data: Data,
  paneIndex: number,
  grabbedKeys: string[],
  insertBeforeKey: string | undefined,
  indent: number
): Plan {
  const rows = writerRows(data, paneIndex);
  const indexOfKey = new Map(rows.map((row, i) => [row.viewKey, i] as const));
  const requested = grabbedKeys.map((key) => indexOfKey.get(key));
  if (requested.some((index) => index === undefined)) {
    return plan;
  }
  const sorted = requested
    .flatMap((index) => (index === undefined ? [] : [index]))
    .sort((left, right) => left - right);
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
    return plan;
  }
  const graph = graphLookupFromData(data);
  const hostEmbeds = new Map<Row, GraphNode>();
  const refused = blocks.some(({ start }) => {
    const row = rows[start];
    if (row.parentRef === undefined) {
      return true;
    }
    if (!row.projected) {
      return false;
    }
    if (row.demoted || row.cycle) {
      return true;
    }
    if (row.spokenFor !== undefined) {
      const statement = getWorkspaceNode(plan.knowledgeDBs, row.spokenFor);
      const membership = statement && fileMembershipNode(plan, statement);
      if (!membership || !embedResolves(graph, membership)) {
        return true;
      }
      hostEmbeds.set(row, membership);
      return false;
    }
    const origin = hostEmbedRowOf(rows, start);
    if (!origin || origin.dangling) {
      return true;
    }
    hostEmbeds.set(row, origin.node);
    return false;
  });
  if (refused) {
    return plan;
  }
  const inBlocks = new Set<number>(
    blocks.flatMap(({ start, end }) =>
      Array.from({ length: end - start }, (ignored, offset) => start + offset)
    )
  );
  const remaining = rows.filter((ignored, index) => !inBlocks.has(index));
  const insertAt =
    insertBeforeKey === undefined
      ? remaining.length
      : remaining.findIndex((row) => row.viewKey === insertBeforeKey);
  if (insertAt < 0) {
    return plan;
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
  const links = screenLinksOf(entries);
  const context: MoveContext = {
    entries,
    links,
    graph,
    updates: new Map<ID, GraphNode>(),
  };
  const grabbedRoots = new Set(blocks.map(({ start }) => rows[start]));
  const applied = [...grabbedRoots].every((row) => {
    const index = entries.findIndex((entry) => entry.row === row);
    if (index < 0) {
      return false;
    }
    if (row.projected) {
      const host = hostEmbeds.get(row);
      return host ? moveGrabbedProjected(plan, context, index, host) : false;
    }
    const membership = fileMembershipNode(plan, row.node);
    if (membership !== undefined) {
      const node = currentNodeOf(plan, context.updates, row.node.id);
      if (!node) {
        return false;
      }
      stageLadder(
        context.updates,
        node,
        ladderOf(context.links, index, membership.id)
      );
      return true;
    }
    return moveGrabbedHome(plan, context, index);
  });
  if (!applied) {
    return plan;
  }
  entries.forEach((ignored, index) =>
    repairPositionedEntry(plan, context, index, grabbedRoots)
  );
  const written = [...context.updates.values()].reduce(
    (acc, node) => planUpsertNodes(acc, node),
    plan
  );
  return [...grabbedRoots].reduce((acc, row) => {
    const index = entries.findIndex((entry) => entry.row === row);
    const parentEntry = links.parent[index];
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
/* eslint-enable functional/immutable-data */
