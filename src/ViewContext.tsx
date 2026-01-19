import React from "react";
import { List, Set as ImmutableSet, Map } from "immutable";
import { v4 } from "uuid";
import {
  getRelations,
  getRelationsNoReferencedBy,
  isRemote,
  joinID,
  shortID,
  splitID,
  isRefId,
  buildReferenceNode,
  itemMatchesType,
  VERSIONS_NODE_ID,
} from "./connections";
import { newDB } from "./knowledge";
import { useData } from "./DataContext";
import { Plan, planUpsertRelations, planUpdateViews } from "./planner";
import { usePaneNavigation } from "./SplitPanesContext";
import { REFERENCED_BY } from "./constants";

// only exported for tests
export type NodeIndex = number & { readonly "": unique symbol };

export const ADD_TO_NODE = "ADD_TO_NODE" as LongID;

export type DiffItem = {
  nodeID: LongID;
  sourceRelationId: LongID;
};

/**
 * Calculate items that other users have in their relation lists
 * that the current user doesn't have.
 *
 * Logic:
 * - Get current user's items for this node (filtered by type)
 * - Get all other users' relations on same node
 * - Filter to items that have the requested type and aren't "not_relevant"
 * - Exclude items that are in the currently viewed relation (to avoid duplication)
 * - Return items that exist in others' but not in user's (deduplicated)
 */
export function getDiffItemsForNode(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID,
  filterTypes: (Relevance | Argument | "suggestions")[],
  currentRelationId?: LongID
): List<DiffItem> {
  // If no filter types or empty array, return no diff items
  if (!filterTypes || filterTypes.length === 0) {
    return List<DiffItem>();
  }

  // If "suggestions" is not in the filter types, don't show any diff items
  if (!filterTypes.includes("suggestions")) {
    return List<DiffItem>();
  }

  // Filter out "suggestions" to get only relevance/argument types for item matching
  const itemFilters = filterTypes.filter(
    (t): t is Relevance | Argument => t !== "suggestions"
  );

  const [, localID] = splitID(nodeID);

  // Get ALL items the current user has (any type) - we exclude these from suggestions
  const myDB = knowledgeDBs.get(myself);
  const myRelations = myDB?.relations
    .filter((r) => r.head === localID)
    .toList();
  const myAllItems: ImmutableSet<LongID | ID> = (
    myRelations || List<Relations>()
  )
    .flatMap((r) => r.items.map((item) => item.nodeID))
    .toSet();

  // Get items from the currently viewed relation (to exclude from diff)
  const currentRelation = currentRelationId
    ? getRelationsNoReferencedBy(knowledgeDBs, currentRelationId, myself)
    : undefined;
  const currentRelationItems: ImmutableSet<LongID | ID> = currentRelation
    ? currentRelation.items.map((item) => item.nodeID).toSet()
    : ImmutableSet<LongID | ID>();

  // Get all other users' relations on this node
  const otherRelations: List<Relations> = knowledgeDBs
    .filter((_, pk) => pk !== myself)
    .toList()
    .flatMap((db) =>
      db.relations
        .filter((r) => r.head === localID && r.id !== currentRelationId)
        .toList()
    );

  // Collect items from others that:
  // - Match any of the active filter types
  // - Are not marked as "not_relevant" by the other user
  // - User doesn't already have in their list (any type)
  const diffItems = otherRelations.reduce(
    (acc: List<DiffItem>, relations: Relations) => {
      const newItems = relations.items
        .filter(
          (item: RelationItem) =>
            // Item must match at least one of the filter types
            itemFilters.some((t) => itemMatchesType(item, t)) &&
            // Never show items the other user marked as not_relevant
            item.relevance !== "not_relevant" &&
            // Exclude items user already has (any type)
            !myAllItems.has(item.nodeID) &&
            !currentRelationItems.has(item.nodeID) &&
            // Deduplicate across other users
            !acc.find((d) => d.nodeID === item.nodeID)
        )
        .map((item: RelationItem) => ({
          nodeID: item.nodeID as LongID,
          sourceRelationId: relations.id,
        }));
      return acc.concat(newItems);
    },
    List<DiffItem>()
  );

  return diffItems;
}

type SubPath = {
  nodeID: LongID | ID;
  nodeIndex: NodeIndex;
  isDiffItem?: boolean;
};

type SubPathWithRelations = SubPath & {
  relationsID: ID;
};

export type ViewPath =
  | readonly [number, SubPath]
  | readonly [number, ...SubPathWithRelations[], SubPath];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

// Encode nodeID to handle colons in ref IDs (ref:ctx:target format)
function encodeNodeID(nodeID: string): string {
  return nodeID.replace(/:/g, "%3A");
}

function decodeNodeID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 3) {
    throw new Error("Invalid view path");
  }

  // First piece is pane index (e.g., "p0")
  const paneIndex = parseInt(pieces[0].substring(1), 10);
  const pathPieces = pieces.slice(1);

  const nodeIndexEnd = parseInt(
    pathPieces[pathPieces.length - 1],
    10
  ) as NodeIndex;
  const nodeIdEnd = decodeNodeID(pathPieces[pathPieces.length - 2]) as LongID;

  const beginning = pathPieces
    .slice(0, -2)
    .reduce(
      (
        acc: SubPathWithRelations[],
        piece,
        index,
        subPaths
      ): SubPathWithRelations[] => {
        if (index % 3 === 0) {
          const nodeID = decodeNodeID(piece) as LongID;
          const indexValue = parseInt(subPaths[index + 1], 10) as NodeIndex;
          const relationID = decodeNodeID(subPaths[index + 2]);
          return [
            ...acc,
            { nodeID, nodeIndex: indexValue, relationsID: relationID },
          ];
        }
        return acc;
      },
      []
    );
  return [
    paneIndex,
    ...beginning,
    { nodeID: nodeIdEnd, nodeIndex: nodeIndexEnd },
  ];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathWithoutPane = viewContext.slice(1) as readonly SubPath[];
  const withoutLastElement = pathWithoutPane.slice(
    0,
    -1
  ) as SubPathWithRelations[];
  const beginning = withoutLastElement.reduce(
    (acc: string, subPath: SubPathWithRelations): string => {
      const postfix = `${encodeNodeID(subPath.nodeID)}:${subPath.nodeIndex
        }:${encodeNodeID(subPath.relationsID)}`;
      return acc !== "" ? `${acc}:${postfix}` : postfix;
    },
    ""
  );
  const lastPath = pathWithoutPane[pathWithoutPane.length - 1];
  const end = `${encodeNodeID(lastPath.nodeID)}:${lastPath.nodeIndex}`;
  const pathPart = beginning !== "" ? `${beginning}:${end}` : end;
  return `p${paneIndex}:${pathPart}`;
}

// TODO: delete this export
export const viewPathToString = convertViewPathToString;

/**
 * Derives the context (path of ancestor IDs) from the pane stack and view path.
 * Context is used to show different children based on how you navigated to a node.
 *
 * @param stack - The pane navigation stack (from usePaneNavigation)
 * @param viewPath - The tree path within current workspace (from useViewPath)
 * @returns Context (List<ID>) representing the path TO the current node (excluding the node itself)
 */
export function getContextFromStackAndViewPath(
  stack: (LongID | ID)[],
  viewPath: ViewPath
): Context {
  // Stack without last element (activeWorkspace) - these are the stacked workspaces
  const stackContext = stack.slice(0, -1).map((id) => shortID(id));

  // ViewPath without pane index (first) and current node (last)
  // This gives us the path within the current workspace leading to the current node
  const viewPathContext = viewPath
    .slice(1, -1)
    .map((subPath) => shortID((subPath as { nodeID: LongID | ID }).nodeID));

  return List([...stackContext, ...viewPathContext]);
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

// Sort relations by updated timestamp (most recent first)
function sortRelationsByDate(relations: List<Relations>): List<Relations> {
  return relations.sort((a, b) => b.updated - a.updated);
}

export function contextsMatch(a: Context, b: Context): boolean {
  return a.equals(b);
}

export function getAvailableRelationsForNode(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  id: LongID | ID,
  context: Context = List(),
  onlyMine?: boolean
): List<Relations> {
  const myRelations = knowledgeDBs.get(myself, newDB()).relations;
  const [remote, localID] = splitID(id);
  const relations: List<Relations> = sortRelationsByDate(
    myRelations
      .filter((r) => r.head === localID && contextsMatch(r.context, context))
      .toList()
  );

  if (onlyMine) {
    return relations;
  }

  const remoteDB =
    remote && isRemote(remote, myself)
      ? knowledgeDBs.get(remote, newDB())
      : undefined;
  const preferredRemoteRelations: List<Relations> = remoteDB
    ? sortRelationsByDate(
      remoteDB.relations
        .filter(
          (r) => r.head === localID && contextsMatch(r.context, context)
        )
        .toList()
    )
    : List<Relations>();
  const otherRelations: List<Relations> = knowledgeDBs
    .filter((_, k) => k !== myself && k !== remote)
    .map((db) =>
      sortRelationsByDate(
        db.relations
          .filter(
            (r) => r.head === localID && contextsMatch(r.context, context)
          )
          .toList()
      )
    )
    .toList()
    .flatten(1) as List<Relations>;
  return relations.concat(preferredRemoteRelations).concat(otherRelations);
}

export function getDefaultRelationForNode(
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  context: Context = List()
): LongID | undefined {
  return getAvailableRelationsForNode(knowledgeDBs, myself, id, context).first()
    ?.id;
}

function getDefaultView(
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  context: Context = List()
): View {
  return {
    relations: getDefaultRelationForNode(id, knowledgeDBs, myself, context),
    width: 1,
    // ROOT starts expanded by default
    expanded: id === "ROOT",
  };
}

function getNodeFromAnyDB(
  knowledgeDBs: KnowledgeDBs,
  id: string
): KnowNode | undefined {
  return knowledgeDBs
    .map((db) => db.nodes.get(id))
    .filter((node) => node !== undefined)
    .first(undefined);
}

export function getNodeFromID(
  knowledgeDBs: KnowledgeDBs,
  id: ID | LongID,
  myself: PublicKey
): KnowNode | undefined {
  // Handle ref IDs - build a virtual ReferenceNode
  if (isRefId(id)) {
    return buildReferenceNode(id as LongID, knowledgeDBs, myself);
  }

  const [remote, knowID] = splitID(id);
  const db = knowledgeDBs.get(remote || myself, newDB());
  const node = db.nodes.get(knowID);
  if (!node && remote === undefined) {
    // Check for special local nodes like ROOT that aren't stored in events
    const defaultNode = newDB().nodes.get(knowID);
    if (defaultNode) {
      return defaultNode;
    }
    return getNodeFromAnyDB(knowledgeDBs, knowID);
  }
  return node;
}

export type TypeFilters = (Relevance | Argument | "suggestions")[];

export const VERSION_FILTERS: TypeFilters = [
  "",
  "relevant",
  "little_relevant",
  "confirms",
  "contra",
];

/**
 * Filter relation items by type filters.
 */
export function filterRelationItems(
  items: List<RelationItem>,
  filters: TypeFilters
): List<RelationItem> {
  const itemFilters = filters.filter(
    (f): f is Relevance | Argument => f !== "suggestions"
  );
  return items.filter((item) =>
    itemFilters.some((f) => itemMatchesType(item, f))
  );
}

/**
 * Get filtered relation items for a node in a context.
 */
export function getRelationItems(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID,
  context: Context,
  filters: TypeFilters,
  onlyMine?: boolean
): List<RelationItem> {
  const relations = getAvailableRelationsForNode(
    knowledgeDBs,
    myself,
    nodeID,
    context,
    onlyMine
  ).first();
  if (!relations) return List();
  return filterRelationItems(relations.items, filters);
}

/**
 * Get the context for looking up versions of a node.
 * This is the path TO the node plus the node's ID.
 */
export function getVersionsContext(nodeID: ID, context: Context): Context {
  return context.push(nodeID);
}

/**
 * Get the versions relations for a node.
 */
export function getVersionsRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: ID,
  context: Context
): Relations | undefined {
  const versionsContext = getVersionsContext(nodeID, context);
  return getAvailableRelationsForNode(
    knowledgeDBs,
    myself,
    VERSIONS_NODE_ID,
    versionsContext,
    true
  ).first();
}

/**
 * Get versioned display text for a node.
 */
export function getVersionedDisplayText(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: ID,
  context: Context
): string | undefined {
  const versionsRelations = getVersionsRelations(
    knowledgeDBs,
    myself,
    nodeID,
    context
  );
  if (!versionsRelations) return undefined;

  const versions = filterRelationItems(versionsRelations.items, VERSION_FILTERS);
  const firstVersion = versions.first();
  if (!firstVersion) return undefined;
  return getNodeFromID(knowledgeDBs, firstVersion.nodeID, myself)?.text;
}

export function getLast(viewContext: ViewPath): SubPath {
  return viewContext[viewContext.length - 1] as SubPath;
}

export function getPaneIndex(viewContext: ViewPath): number {
  return viewContext[0] as number;
}

export function getViewFromPath(data: Data, path: ViewPath): View {
  const { nodeID } = getLast(path);
  return (
    getViewExactMatch(data.views, path) ||
    getDefaultView(nodeID, data.knowledgeDBs, data.user.publicKey)
  );
}

export function getNodeIDFromView(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] {
  const view = getViewFromPath(data, viewPath);
  const { nodeID } = getLast(viewPath);
  return [nodeID, view];
}

export function getNodeFromView(
  data: Data,
  viewPath: ViewPath
): [KnowNode, View] | [undefined, undefined] {
  const [nodeID, view] = getNodeIDFromView(data, viewPath);
  const node = getNodeFromID(data.knowledgeDBs, nodeID, data.user.publicKey);
  if (!node) {
    return [undefined, undefined];
  }
  return [node, view];
}

/**
 * Get the relation for a view, considering both view preference and context.
 * This is the canonical read-only relation lookup function.
 *
 * Logic:
 * 1. If view has REFERENCED_BY, return Referenced By relations (special case)
 * 2. If view has explicit relationsID AND it matches current context, use it
 * 3. Otherwise, find relation by (head, context)
 * 4. Returns undefined if no relation found (does not create)
 */
export function getRelationForView(
  data: Data,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): Relations | undefined {
  const [nodeID, view] = getNodeIDFromView(data, viewPath);
  const context = getContextFromStackAndViewPath(stack, viewPath);

  // Handle REFERENCED_BY specially - it's not context-based
  if (view.relations === REFERENCED_BY) {
    return getRelations(
      data.knowledgeDBs,
      REFERENCED_BY,
      data.user.publicKey,
      nodeID
    );
  }

  // Check if view's relation exists and matches current context
  if (view.relations) {
    const viewRelations = getRelationsNoReferencedBy(
      data.knowledgeDBs,
      view.relations,
      data.user.publicKey
    );
    if (viewRelations && contextsMatch(viewRelations.context, context)) {
      return viewRelations;
    }
  }

  // Find relation by (head, context)
  return getAvailableRelationsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    nodeID,
    context
  ).first();
}

export function calculateNodeIndex(
  relations: Relations,
  index: number
): NodeIndex {
  const item = relations.items.get(index);
  if (!item) {
    throw new Error(`No item found at index ${index}`);
  }
  // find same relation before this index
  return relations.items.slice(0, index).filter((i) => i.nodeID === item.nodeID)
    .size as NodeIndex;
}

export function calculateIndexFromNodeIndex(
  relations: Relations,
  node: LongID | ID,
  nodeIndex: NodeIndex
): number | undefined {
  // Find the nth occurance of the node in the list
  const { items } = relations;
  const res = items.reduce(
    ([acc, found]: [number, boolean], item, idx): [number, boolean] => {
      if (found) {
        return [acc, true];
      }
      if (item.nodeID === node) {
        if (acc === nodeIndex) {
          return [idx, true];
        }
        return [acc + 1, false];
      }
      return [acc, false];
    },
    [0, false]
  );
  if (res[1] === false) {
    return undefined;
  }
  return res[0];
}

function addRelationsToLastElement(
  path: ViewPath,
  relationsID: LongID
): [number, ...SubPathWithRelations[]] {
  const paneIndex = getPaneIndex(path);
  // Skip pane index (position 0) and last element
  const middleElements = path.slice(1, -1) as SubPathWithRelations[];
  return [paneIndex, ...middleElements, { ...getLast(path), relationsID }];
}

export function addAddToNodeToPath(
  data: Data,
  path: ViewPath,
  stack: (LongID | ID)[]
): ViewPath {
  const relations = getRelationForView(data, path, stack);
  // Assume there is only one Add to node per parent
  const nodeIndex = 0 as NodeIndex;
  const withRelations = addRelationsToLastElement(
    path,
    relations?.id || ("" as LongID)
  );
  return [...withRelations, { nodeID: ADD_TO_NODE, nodeIndex }];
}

export function addNodeToPathWithRelations(
  path: ViewPath,
  relations: Relations,
  index: number
): ViewPath {
  const item = relations.items.get(index);
  if (!item) {
    // eslint-disable-next-line no-console
    console.error("No node found in relations", relations, " at index", index);
    throw new Error("No node found in relation at index");
  }
  const nodeIndex = calculateNodeIndex(relations, index);
  const pathWithRelations = addRelationsToLastElement(path, relations.id);
  return [...pathWithRelations, { nodeID: item.nodeID, nodeIndex }];
}

export function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number
): ViewPath {
  // For path-building, use the view's stored relations directly
  // This is used by PushNode/RootViewContextProvider for navigation
  const [nodeID, view] = getNodeIDFromView(data, path);
  const relations = getRelations(
    data.knowledgeDBs,
    view.relations,
    data.user.publicKey,
    nodeID
  );
  if (!relations) {
    throw new Error("Parent doesn't have relations, cannot add to path");
  }
  return addNodeToPathWithRelations(path, relations, index);
}

/**
 * Add a diff item (from other users) to the path.
 * Uses the parent's relation context but with a nodeID that's not in the user's own relation.
 */
export function addDiffItemToPath(
  data: Data,
  path: ViewPath,
  nodeID: LongID,
  diffIndex: number,
  stack: (LongID | ID)[]
): ViewPath {
  const relations = getRelationForView(data, path, stack);
  // Use 0 as nodeIndex since diff items don't have duplicates in our list
  const nodeIndex = diffIndex as NodeIndex;
  const pathWithRelations = addRelationsToLastElement(
    path,
    relations?.id || ("" as LongID)
  );
  return [...pathWithRelations, { nodeID, nodeIndex, isDiffItem: true }];
}

function popPath(viewContext: ViewPath): ViewPath | undefined {
  const paneIndex = getPaneIndex(viewContext);
  // Get elements after pane index, excluding the last one
  const pathWithoutLast = viewContext.slice(1, -1) as SubPathWithRelations[];
  const parent = pathWithoutLast[pathWithoutLast.length - 1];
  if (!parent) {
    return undefined;
  }
  return [
    paneIndex,
    ...pathWithoutLast.slice(0, -1),
    { nodeID: parent.nodeID, nodeIndex: parent.nodeIndex },
  ];
}

export function getParentView(viewContext: ViewPath): ViewPath | undefined {
  return popPath(viewContext);
}

/**
 * Check if the current node is not in my list but in the list of another user.
 */
export function useIsDiffItem(): boolean {
  const data = useData();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const parentPath = getParentView(viewPath);

  if (!parentPath) {
    return false;
  }

  const [nodeID] = getNodeIDFromView(data, viewPath);

  // ADD_TO_NODE is not a diff item
  if (nodeID === ADD_TO_NODE) {
    return false;
  }
  const parentRelations = getRelationForView(data, parentPath, stack);
  if (!parentRelations) {
    return false;
  }

  // If the node is not in the parent's relation items, it's a diff item
  return !parentRelations.items.some((item) => item.nodeID === nodeID);
}

/**
 * Check if we're currently viewing a Referenced By relation.
 * Items in Referenced By view are readonly - no editing, no dropping onto them.
 */
export function useIsInReferencedByView(): boolean {
  const data = useData();
  const viewPath = useViewPath();
  const parentPath = getParentView(viewPath);

  if (!parentPath) {
    return false;
  }

  const [, parentView] = getNodeIDFromView(data, parentPath);
  return parentView?.relations === REFERENCED_BY;
}

export function popViewPath(
  viewContext: ViewPath,
  times: number
): ViewPath | undefined {
  return Array.from({ length: times }).reduce<ViewPath | undefined>(
    (current) => (current ? getParentView(current) : undefined),
    viewContext
  );
}

export function getRelationIndex(
  data: Data,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): number | undefined {
  const { nodeIndex, nodeID } = getLast(viewPath);
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }
  const relations = getRelationForView(data, parentPath, stack);
  if (!relations) {
    return undefined;
  }
  if (nodeID === ADD_TO_NODE) {
    return relations.items.size;
  }
  return calculateIndexFromNodeIndex(relations, nodeID, nodeIndex);
}

export function useRelationIndex(): number | undefined {
  const path = useViewPath();
  const data = useData();
  const { stack } = usePaneNavigation();
  return getRelationIndex(data, path, stack);
}

export type SiblingInfo = {
  viewPath: ViewPath;
  nodeID: LongID | ID;
  view: View;
};

export function getPreviousSibling(
  data: Data,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): SiblingInfo | undefined {
  const relationIndex = getRelationIndex(data, viewPath, stack);
  if (relationIndex === undefined || relationIndex === 0) {
    // No previous sibling (first item or error)
    return undefined;
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }

  // Get the previous sibling's path
  // Try-catch handles case where parent relations are not properly set up (e.g., in tests)
  try {
    const prevSiblingPath = addNodeToPath(data, parentPath, relationIndex - 1);
    const [prevNodeID, prevView] = getNodeIDFromView(data, prevSiblingPath);

    return {
      viewPath: prevSiblingPath,
      nodeID: prevNodeID,
      view: prevView,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get the last direct child of a node, or undefined if no children.
 */
export function getLastChild(
  data: Data,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): ViewPath | undefined {
  const relations = getRelationForView(data, viewPath, stack);
  if (!relations || relations.items.size === 0) {
    return undefined;
  }
  const lastIndex = relations.items.size - 1;
  return addNodeToPathWithRelations(viewPath, relations, lastIndex);
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  return getPreviousSibling(data, viewPath, stack);
}

export function RootViewContextProvider({
  children,
  root,
  paneIndex = 0,
  indices, // TODO: only used in tests, get rid of it
}: {
  children: React.ReactNode;
  root: LongID | ID;
  paneIndex?: number;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const startPath: ViewPath = [
    paneIndex,
    { nodeID: root, nodeIndex: 0 as NodeIndex },
  ];
  const finalPath = (indices || List<number>()).reduce(
    (acc, index) => addNodeToPath(data, acc, index),
    startPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function PushNode({
  children,
  push,
}: {
  children: React.ReactNode;
  push: List<number>;
}): JSX.Element {
  const data = useData();
  const existingPath = useViewPath();
  const finalPath = push.reduce(
    (acc, index) => addNodeToPath(data, acc, index),
    existingPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function useNodeID(): [LongID | ID, View] {
  const data = useData();
  const viewPath = useViewPath();
  return getNodeIDFromView(data, viewPath);
}

export function useNode(): [KnowNode, View] | [undefined, undefined] {
  return getNodeFromView(useData(), useViewPath());
}

export function getParentNode(
  data: Data,
  viewPath: ViewPath
): [KnowNode, View] | [undefined, undefined] {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return [undefined, undefined];
  }
  return getNodeFromView(data, parentPath);
}

export function getParentNodeID(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] | [undefined, undefined] {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return [undefined, undefined];
  }
  return getNodeIDFromView(data, parentPath);
}

export function useParentNode(): [KnowNode, View] | [undefined, undefined] {
  return getParentNode(useData(), useViewPath());
}

export function useIsAddToNode(): boolean {
  const viewContext = useViewPath();
  return getLast(viewContext).nodeID === ADD_TO_NODE;
}

export function isExpanded(data: Data, viewKey: string): boolean {
  const viewPath = parseViewPath(viewKey);
  const view = getViewFromPath(data, viewPath);
  return view.expanded === true;
}

export function useViewKey(): string {
  return viewPathToString(useViewPath());
}

export function useIsExpanded(): boolean {
  const data = useData();
  const viewKey = useViewKey();
  return isExpanded(data, viewKey);
}

export function useIsRoot(): boolean {
  const viewPath = useViewPath();
  return viewPath.length === 2;
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -3).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  return views.set(viewPathToString(path), view);
}

export function deleteChildViews(views: Views, path: ViewPath): Views {
  const key = viewPathToString(path);
  return views.filter((v, k) => !k.startsWith(key) || k === key);
}

function getChildViews(views: Views, path: ViewPath): Views {
  const key = viewPathToString(path);
  return views.filter((v, k) => k.startsWith(key) && k !== key);
}

export function newRelations(
  head: LongID | ID,
  context: Context,
  myself: PublicKey
): Relations {
  return {
    head: shortID(head),
    items: List<RelationItem>(),
    context,
    id: joinID(myself, v4()),
    updated: Math.floor(Date.now() / 1000),
    author: myself,
  };
}

function createUpdatableRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  relationsID: ID,
  head: LongID | ID,
  context: Context
): Relations {
  const [remote, id] = splitID(relationsID);
  if (remote && isRemote(remote, myself)) {
    // copy remote relations
    const remoteRelations = getRelations(
      knowledgeDBs,
      relationsID,
      myself,
      head
    );
    if (!remoteRelations) {
      // This should not happen
      return newRelations(head, context, myself);
    }
    // Make a copy
    return {
      ...remoteRelations,
      id: joinID(myself, v4()),
    };
  }
  return knowledgeDBs
    .get(myself, newDB())
    .relations.get(id, newRelations(head, context, myself));
}

function moveChildViewsToNewRelation(
  views: Views,
  viewPath: ViewPath,
  oldRelationsID: string,
  newRelationsID: string
): Views {
  const viewsWithDeletedChildViews = deleteChildViews(views, viewPath);
  const childViews = getChildViews(views, viewPath);
  const movedChildViews = childViews.reduce((rdx, v, k) => {
    const newKey = k.replace(oldRelationsID, newRelationsID);
    return rdx.set(newKey, v);
  }, Map<string, View>());

  return viewsWithDeletedChildViews.merge(movedChildViews);
}

export function findOrCreateRelationsForContext(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID,
  context: Context,
  viewRelationsID: ID | undefined
): Relations {
  // Check if view's relation has matching context
  const viewRelations = viewRelationsID
    ? getRelationsNoReferencedBy(knowledgeDBs, viewRelationsID, myself)
    : undefined;

  if (viewRelations && contextsMatch(viewRelations.context, context)) {
    return viewRelations;
  }

  // Find existing relation by (head, context) or create new one
  const existingRelations = getAvailableRelationsForNode(
    knowledgeDBs,
    myself,
    nodeID,
    context
  );

  return existingRelations.first() || newRelations(nodeID, context, myself);
}

export function upsertRelations(
  plan: Plan,
  viewPath: ViewPath,
  stack: (LongID | ID)[],
  modify: (relations: Relations) => Relations
): Plan {
  const [nodeID, nodeView] = getNodeIDFromView(plan, viewPath);
  const context = getContextFromStackAndViewPath(stack, viewPath);

  const foundRelations = findOrCreateRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    nodeID,
    context,
    nodeView.relations
  );

  // If relations belong to someone else, create a copy before modifying
  const relations =
    foundRelations.author !== plan.user.publicKey
      ? createUpdatableRelations(
        plan.knowledgeDBs,
        plan.user.publicKey,
        foundRelations.id,
        nodeID,
        context
      )
      : foundRelations;

  const oldRelationsID = nodeView.relations || foundRelations.id;
  const didViewChange = oldRelationsID !== relations.id;
  const planWithUpdatedView = didViewChange
    ? planUpdateViews(
      plan,
      moveChildViewsToNewRelation(
        plan.views,
        viewPath,
        oldRelationsID,
        relations.id
      ).set(viewPathToString(viewPath), {
        ...nodeView,
        relations: relations.id,
      })
    )
    : plan;

  const updatedRelations = modify(relations);
  return planUpsertRelations(planWithUpdatedView, updatedRelations);
}

/*
 * input for example
 * ws:0:2:0
 *
 * returns
 * ws
 * ws:0
 * ws:0:2
 * ws:0:2:0
 * */
function getAllSubpaths(path: string): ImmutableSet<string> {
  return path.split(":").reduce((acc, p) => {
    const lastPath = acc.last(undefined);
    return acc.add(lastPath ? `${lastPath}:${p}` : `${p}`);
  }, ImmutableSet<string>());
}

function findViewsForRepo(
  data: Data,
  id: string,
  relationsID: ID
): ImmutableSet<string> {
  // include partial, non existing views
  const paths = data.views.reduce((acc, _, path) => {
    return acc.merge(getAllSubpaths(path));
  }, ImmutableSet<string>());
  return paths.filter((path) => {
    try {
      const [nodeID, view] = getNodeIDFromView(data, parseViewPath(path));
      return nodeID === id && view.relations === relationsID;
    } catch {
      // Some view paths lead to nowhere
      return false;
    }
  });
}

function updateRelationViews(
  views: Views,
  parentViewPath: string,
  update: (relations: List<string | undefined>) => List<string | undefined>
): Views {
  const childPaths = views
    .keySeq()
    .toList()
    .filter((path) => path.startsWith(`${parentViewPath}:`));

  /*
   * ws:0:1 => ws:0:2
   * ws:0:2 => ws:0:3
   * ws:0:2:0 => ws:0:3:0
   * ws:0:2:1 => ws:0:3:1
   */

  const toReplace = childPaths.reduce((acc, path) => {
    // Figure out the which index position this relationship has to the parent
    const subpath = path.substring(parentViewPath.length + 1);
    const index = parseInt(subpath.split(":")[0], 10);
    return acc.set(index, `${parentViewPath}:${index}`);
  }, List<string | undefined>([]));
  const updatedPositions = update(toReplace);
  const replaceWith = updatedPositions.reduce((acc, replaceString, newPos) => {
    if (replaceString === undefined) {
      return acc;
    }
    const replaceW = `${parentViewPath}:${newPos}`;
    return acc.set(replaceString, replaceW);
  }, Map<string, string>());

  return views.mapEntries(([path, view]) => {
    if (path.length <= parentViewPath.length) {
      return [path, view];
    }
    const subpath = path.substring(parentViewPath.length + 1);
    const index = parseInt(subpath.split(":")[0], 10);
    const replace = `${parentViewPath}:${index}`;
    const w = replaceWith.get(replace);
    if (w === undefined) {
      return [path, view];
    }
    return [path.replace(replace, w), view];
  });
}

function moveChildViews(
  views: Views,
  parentViewPath: string,
  indices: Array<number>,
  startPosition: number
): Views {
  return updateRelationViews(views, parentViewPath, (relations) => {
    const viewsToMove = List<string | undefined>(
      indices.map((i) => relations.get(i))
    );
    return relations
      .filterNot((_, i) => indices.includes(i))
      .splice(startPosition, 0, ...viewsToMove.toArray());
  });
}

export function updateViewPathsAfterMoveRelations(
  data: Data,
  toView: ViewPath,
  indices: Array<number>,
  startPosition?: number
): Views {
  // moved to the end, nothing to do
  if (startPosition === undefined) {
    return data.views;
  }
  const [nodeID, view] = getNodeIDFromView(data, toView);
  if (!view.relations) {
    return data.views;
  }
  const viewKeys = findViewsForRepo(data, nodeID, view.relations);
  const sortedViewKeys = viewKeys.sort(
    (a, b) => b.split(":").length - a.split(":").length
  );
  return sortedViewKeys.reduce((accViews, parentViewPath) => {
    return moveChildViews(accViews, parentViewPath, indices, startPosition);
  }, data.views);
}

export function updateViewPathsAfterAddRelation(
  data: Data,
  viewPath: ViewPath,
  ord?: number
): Views {
  // nothing to do
  if (ord === undefined) {
    return data.views;
  }
  const [nodeID, view] = getNodeIDFromView(data, viewPath);
  if (!view.relations) {
    return data.views;
  }
  const viewKeys = findViewsForRepo(data, nodeID, view.relations);

  const sortedViewKeys = viewKeys.sort(
    (a, b) => b.split(":").length - a.split(":").length
  );

  return sortedViewKeys.reduce((accViews, parentViewPath) => {
    const childPaths = accViews
      .keySeq()
      .toList()
      .filter((path) => path.startsWith(parentViewPath));

    const lastChildIndex =
      (childPaths
        // eslint-disable-next-line functional/immutable-data
        .map((path) => parseInt(path.split(":").pop() as string, 10))
        .max() as number) + 1;

    const indices = [lastChildIndex];
    const startPosition = ord;
    return moveChildViews(accViews, parentViewPath, indices, startPosition);
  }, data.views);
}

export function updateViewPathsAfterDeleteNode(
  views: Views,
  nodeID: LongID | ID
): Views {
  return views.filterNot((_, k) => k.includes(nodeID));
}

/*
 * A:R:2:B:R2:2 -> A:R:1:B:R2:2
 * A:R2:1:B:R:2 -> A:R2:1:B:R:1
 * C:R:0 -> C:R:0
 * A:R:2:B:R:2 -> A:R:1:B:R:1
 * R:1:R:2 -> deleted
 * A:R2:1:B:R:1 -> deleted
 */

function alterPath(
  viewPath: string,
  calcIndex: (relation: LongID, node: LongID, index: NodeIndex) => NodeIndex
): string {
  const paths = viewPath.split(":");
  return paths
    .map((path, idx) => {
      // The first two values are root:0
      if (idx >= 4 && (idx - 1) % 3 === 0) {
        const relation = paths[idx - 2] as LongID;
        const node = paths[idx - 1] as LongID;
        const index = parseInt(paths[idx], 10) as NodeIndex;
        return calcIndex(relation, node, index);
      }
      return path;
    })
    .join(":");
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: LongID | ID,
  fromRelation: LongID,
  nodeIndex: NodeIndex
): Views {
  // If I delete A:0, A:1 will be A:0, A:2 will be A:1 ...
  const toDelete = `${fromRelation}:${disconnectNode}:${nodeIndex}`;
  const withDeleted = views.filterNot(
    (_, k) => k.includes(`${toDelete}:`) || k.endsWith(toDelete)
  );

  const lookForPrefix = `${fromRelation}:${disconnectNode}:`;

  return withDeleted.mapKeys((key) => {
    if (!key.includes(lookForPrefix)) {
      return key;
    }
    return alterPath(key, (relation, node, index) => {
      if (
        relation === fromRelation &&
        node === disconnectNode &&
        index > nodeIndex
      ) {
        return (index - 1) as NodeIndex;
      }
      return index;
    });
  });
}

export function updateViewPathsAfterPaneDelete(
  views: Views,
  removedPaneIndex: number
): Views {
  return views
    .filterNot((_, key) => key.startsWith(`p${removedPaneIndex}:`))
    .mapKeys((key) => {
      const match = key.match(/^p(\d+):/);
      if (!match) return key;
      const paneIndex = parseInt(match[1], 10);
      if (paneIndex > removedPaneIndex) {
        return key.replace(/^p\d+:/, `p${paneIndex - 1}:`);
      }
      return key;
    });
}

export function clearViewsForPane(views: Views, paneIndex: number): Views {
  return views.filterNot((_, key) => key.startsWith(`p${paneIndex}:`));
}

export function updateViewPathsAfterPaneInsert(
  views: Views,
  insertedPaneIndex: number
): Views {
  // When inserting a pane at index N, shift all pane indices >= N up by 1
  return views.mapKeys((key) => {
    const match = key.match(/^p(\d+):/);
    if (!match) return key;
    const paneIndex = parseInt(match[1], 10);
    if (paneIndex >= insertedPaneIndex) {
      return key.replace(/^p\d+:/, `p${paneIndex + 1}:`);
    }
    return key;
  });
}

export function bulkUpdateViewPathsAfterAddRelation(
  data: Data,
  repoPath: ViewPath,
  nAdds: number,
  startPos?: number
): Views {
  return List<undefined>([])
    .set(nAdds - 1, undefined)
    .reduce((rdx, i, currentIndex) => {
      return updateViewPathsAfterAddRelation(
        { ...data, views: rdx },
        repoPath,
        startPos !== undefined ? startPos + currentIndex : undefined
      );
    }, data.views);
}
