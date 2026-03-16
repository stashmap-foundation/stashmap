/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { List, Map } from "immutable";
import {
  computeEmptyNodeMetadata,
  getRelations,
  getNode,
  shortID,
  isSearchId,
  parseSearchId,
  itemMatchesType,
  EMPTY_SEMANTIC_ID,
  itemPassesFilters,
  getRelationContext,
  getNodeSemanticID,
  getSemanticID,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
} from "./connections";
import { buildReferenceItem } from "./buildReferenceRow";
import { resolveSemanticRelationInCurrentTree } from "./semanticNavigation";
import { useData } from "./DataContext";
import { Plan, planUpsertRelations, getPane } from "./planner";
import { usePaneStack } from "./SplitPanesContext";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { newRelations } from "./relationFactory";
import { getRelationUserPublicKey } from "./userEntries";

export { newRelations } from "./relationFactory";

type ViewPathSegment = ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export type VirtualItemsMap = Map<string, GraphNode>;

const VirtualItemsContext = React.createContext<VirtualItemsMap>(
  Map<string, GraphNode>()
);

const EMPTY_VIEW_PATH_PREFIX = "empty-row:";

export const VirtualItemsProvider = VirtualItemsContext.Provider;

export function useVirtualItemsMap(): VirtualItemsMap {
  return React.useContext(VirtualItemsContext);
}

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

function createEmptyViewPathID(relationsID: LongID): string {
  return `${EMPTY_VIEW_PATH_PREFIX}${relationsID}`;
}

function isEmptyViewPathID(id: ID): boolean {
  return id.startsWith(EMPTY_VIEW_PATH_PREFIX);
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 2) {
    throw new Error("Invalid view path");
  }

  const panePart = pieces[0];
  if (!panePart.startsWith("p")) {
    throw new Error("Invalid view path");
  }

  const paneIndex = parseInt(panePart.substring(1), 10);
  if (Number.isNaN(paneIndex)) {
    throw new Error("Invalid view path");
  }

  const pathPieces = pieces
    .slice(1)
    .map((piece) => decodePathID(piece) as ViewPathSegment);
  if (pathPieces.length === 0) {
    throw new Error("Invalid view path");
  }

  return [paneIndex, ...pathPieces];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathPart = (viewContext.slice(1) as readonly ViewPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

// TODO: delete this export
export const viewPathToString = convertViewPathToString;

function getContextFromStack(stack: ID[]): Context {
  return List(stack.slice(0, -1));
}

export function isRoot(viewPath: ViewPath): boolean {
  return viewPath.length === 2;
}

export function getPaneIndex(viewContext: ViewPath): number {
  return viewContext[0] as number;
}

export function getParentView(viewContext: ViewPath): ViewPath | undefined {
  if (isRoot(viewContext)) {
    return undefined;
  }
  return viewContext.slice(0, -1) as unknown as ViewPath;
}

export function getContext(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Context {
  const directRelation = getViewRelationByID(
    data.knowledgeDBs,
    getLast(viewPath),
    data.user.publicKey
  );
  if (directRelation) {
    return getRelationContext(data.knowledgeDBs, directRelation);
  }
  if (isRoot(viewPath)) {
    return getContextFromStack(stack);
  }
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    throw new Error("Cannot determine context: no parent path found");
  }
  const parentContext = getContext(data, parentPath, stack);
  const parentRelation = getRelationForView(data, parentPath, stack);
  if (parentRelation) {
    return parentContext.push(getSemanticID(data.knowledgeDBs, parentRelation));
  }
  const [parentItemID] = getRowIDFromView(data, parentPath);
  return parentContext.push(shortID(parentItemID as ID) as ID);
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

export function getLast(viewContext: ViewPath): ViewPathSegment {
  return viewContext[viewContext.length - 1] as ViewPathSegment;
}

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

export function getViewFromPath(data: Data, path: ViewPath): View {
  const itemID = getRowIDFromPath(data, path);
  return (
    getViewExactMatch(data.views, path) || getDefaultView(itemID, isRoot(path))
  );
}

function getViewRelationByID(
  knowledgeDBs: KnowledgeDBs,
  id: ID,
  myself: PublicKey
): GraphNode | undefined {
  return getNode(knowledgeDBs, id, myself);
}

function getEmptyRelationItem(
  data: Data,
  parentRelation: GraphNode | undefined
): GraphNode | undefined {
  if (!parentRelation) {
    return undefined;
  }
  return computeEmptyNodeMetadata(data.publishEventsStatus.temporaryEvents).get(
    parentRelation.id as LongID
  )?.relationItem;
}

function getRowIDFromPath(data: Data, viewPath: ViewPath): ID {
  const currentID = getLast(viewPath);
  if (isEmptyViewPathID(currentID)) {
    return EMPTY_SEMANTIC_ID;
  }
  const relation = getNode(data.knowledgeDBs, currentID, data.user.publicKey);
  if (!relation) {
    return currentID;
  }
  if (isRefNode(relation)) {
    return relation.id;
  }
  return getNodeSemanticID(relation);
}

export function getRowIDFromView(data: Data, viewPath: ViewPath): [ID, View] {
  const view = getViewFromPath(data, viewPath);
  return [getRowIDFromPath(data, viewPath), view];
}

export function getRowIDsForViewPath(
  data: Data,
  viewPath: ViewPath
): Array<ID> {
  const paneIndex = getPaneIndex(viewPath);
  return (viewPath.slice(1) as ViewPathSegment[]).map((_, index, segments) =>
    getRowIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
}

export function getParentRelation(
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  if (isRoot(viewPath)) {
    return undefined;
  }
  const parentID = viewPath[viewPath.length - 2] as ViewPathSegment;
  return getRelations(data.knowledgeDBs, parentID, data.user.publicKey);
}

export function getEffectiveAuthor(data: Data, viewPath: ViewPath): PublicKey {
  const pane = getPane(data, viewPath);
  const parentRelation = getParentRelation(data, viewPath);
  return parentRelation?.author || pane.author;
}

export function getRootForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): ID | undefined {
  const currentID = getLast(viewPath);
  const directRelation = getViewRelationByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directRelation) {
    return directRelation.root;
  }

  const parentRelation = getParentRelation(data, viewPath);
  if (parentRelation) {
    return parentRelation.root;
  }

  if (!isRoot(viewPath)) {
    return undefined;
  }

  const [itemID] = getRowIDFromView(data, viewPath);
  const semanticContext = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const author = getEffectiveAuthor(data, viewPath);
  return resolveSemanticRelationInCurrentTree(
    data.knowledgeDBs,
    author,
    itemID,
    semanticContext,
    pane.rootRelation,
    true
  )?.root;
}

export function getRelationForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): GraphNode | undefined {
  const currentID = getLast(viewPath);
  const directRelation = getViewRelationByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directRelation) {
    return directRelation;
  }

  if (!isRoot(viewPath)) {
    return undefined;
  }

  const [itemID] = getRowIDFromView(data, viewPath);
  const semanticContext = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const parentRoot = getParentRelation(data, viewPath)?.root;
  const author = getEffectiveAuthor(data, viewPath);

  return resolveSemanticRelationInCurrentTree(
    data.knowledgeDBs,
    author,
    itemID,
    semanticContext,
    pane.rootRelation,
    isRoot(viewPath),
    parentRoot
  );
}

export function buildPaneTarget(
  data: Data,
  viewPath: ViewPath,
  paneStack: ID[],
  currentItem?: GraphNode
): {
  stack: ID[];
  author: PublicKey;
  rootRelation?: LongID;
  scrollToId?: string;
} {
  const [itemID] = getRowIDFromView(data, viewPath);
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const currentEdge = currentItem || getCurrentEdgeForView(data, viewPath);
  const virtualType = currentEdge?.virtualType;
  const currentRelation = getRelationForView(data, viewPath, paneStack);
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    paneStack,
    virtualType,
    currentEdge
  );
  const refInfo = (() => {
    if (!currentReference) {
      if (isRefNode(currentEdge)) {
        return getRefLinkTargetInfo(
          currentEdge.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
      }
      if (isRefNode(currentRelation)) {
        return getRefLinkTargetInfo(
          currentRelation.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
      }
      return getRefTargetInfo(itemID, data.knowledgeDBs, effectiveAuthor);
    }
    return virtualType === "version"
      ? getRefTargetInfo(
          currentReference.id,
          data.knowledgeDBs,
          effectiveAuthor
        )
      : getRefLinkTargetInfo(
          currentReference.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
  })();
  if (refInfo) {
    return {
      stack: refInfo.stack,
      author: refInfo.author,
      rootRelation: refInfo.rootRelation,
      scrollToId: refInfo.scrollToId,
    };
  }

  const paneStackWithoutRoot = paneStack.slice(0, -1);
  const fullStack = [
    ...paneStackWithoutRoot,
    ...getRowIDsForViewPath(data, viewPath),
  ];
  const relation = getRelationForView(data, viewPath, paneStack);
  return {
    stack: fullStack,
    author: effectiveAuthor,
    rootRelation: relation?.id,
  };
}

export function useSearchDepth(): number | undefined {
  const data = useData();
  const viewPath = useViewPath();

  const loop = (
    currentPath: ViewPath | undefined,
    depth: number
  ): number | undefined => {
    if (!currentPath) return undefined;
    const [itemID] = getRowIDFromView(data, currentPath);
    if (isSearchId(itemID as ID)) {
      return depth;
    }
    return loop(getParentView(currentPath), depth + 1);
  };

  return loop(getParentView(viewPath), 1);
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export type TypeFilters = (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains"
)[];

/**
 * Filter relation children by type filters.
 */
export function filterRelationItems(
  children: List<GraphNode>,
  filters: TypeFilters
): List<GraphNode> {
  const itemFilters = filters.filter(
    (f): f is Relevance | Argument | "contains" =>
      f !== "suggestions" && f !== undefined
  );
  return children.filter((item) =>
    itemFilters.some((f) => itemMatchesType(item, f))
  );
}

export function getCurrentReferenceForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentItem?: GraphNode
): ReferenceRow | undefined {
  const currentEdge = currentItem || getCurrentEdgeForView(data, viewPath);
  const currentRelation = getRelationForView(data, viewPath, stack);
  let referenceID: LongID | undefined;
  if (isRefNode(currentEdge)) {
    referenceID = currentEdge.id as LongID;
  } else if (isRefNode(currentRelation)) {
    referenceID = currentRelation.id as LongID;
  }
  if (!referenceID) {
    return undefined;
  }
  return buildReferenceItem(referenceID, data, viewPath, stack, virtualType);
}

export function addRelationsToLastElement(
  path: ViewPath,
  relationsID: LongID
): ViewPath {
  const last = getLast(path);
  if (last === relationsID) {
    return path;
  }
  return [
    getPaneIndex(path),
    ...(path.slice(1, -1) as ViewPathSegment[]),
    relationsID,
  ] as ViewPath;
}

export function addNodeToPathWithRelations(
  path: ViewPath,
  nodes: GraphNode,
  index: number
): ViewPath {
  const itemID = nodes.children.get(index);
  if (itemID === undefined) {
    throw new Error("No node found in relation at index");
  }
  const pathWithRelations = addRelationsToLastElement(path, nodes.id);
  const nextSegment =
    itemID === EMPTY_SEMANTIC_ID ? createEmptyViewPathID(nodes.id) : itemID;
  return [...pathWithRelations, nextSegment] as ViewPath;
}

export function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number,
  stack: ID[]
): ViewPath {
  const nodes = getRelationForView(data, path, stack);
  if (!nodes) {
    throw new Error("Parent doesn't have nodes, cannot add to path");
  }
  return addNodeToPathWithRelations(path, nodes, index);
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const viewPath = useViewPath();
  return getEffectiveAuthor(data, viewPath);
}

export function useCurrentRelation(): GraphNode | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getRelationForView(data, viewPath, stack);
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const effectiveAuthor = useEffectiveAuthor();
  return effectiveAuthor !== user.publicKey;
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
  viewPath: ViewPath
): number | undefined {
  const nodes = getParentRelation(data, viewPath);
  if (!nodes) {
    return undefined;
  }
  const itemID = getLast(viewPath);
  const index = nodes.children.findIndex(
    (childID) =>
      childID === itemID ||
      (childID === EMPTY_SEMANTIC_ID && isEmptyViewPathID(itemID))
  );
  return index >= 0 ? index : undefined;
}

export function useRelationIndex(): number | undefined {
  const path = useViewPath();
  const data = useData();
  return getRelationIndex(data, path);
}

export function getCurrentEdgeForView(
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  const parentRelation = getParentRelation(data, viewPath);
  if (!parentRelation) {
    return undefined;
  }
  const index = getRelationIndex(data, viewPath);
  if (index === undefined) {
    return undefined;
  }
  const childID = parentRelation.children.get(index);
  if (childID === undefined) {
    return undefined;
  }
  if (childID === EMPTY_SEMANTIC_ID) {
    return getEmptyRelationItem(data, parentRelation);
  }
  return getNode(data.knowledgeDBs, childID, data.user.publicKey);
}

export function useCurrentEdge(): GraphNode | undefined {
  const virtualItems = React.useContext(VirtualItemsContext);
  const data = useData();
  const viewPath = useViewPath();
  const viewKey = viewPathToString(viewPath);
  const virtualItem = virtualItems.get(viewKey);
  if (virtualItem) {
    return virtualItem;
  }
  return getCurrentEdgeForView(data, viewPath);
}

export type SiblingInfo = {
  viewPath: ViewPath;
  itemID: ID;
  view: View;
};

export function getPreviousSibling(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): SiblingInfo | undefined {
  const relationIndex = getRelationIndex(data, viewPath);
  if (relationIndex === undefined || relationIndex === 0) {
    return undefined;
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }

  const parentRelation = getParentRelation(data, viewPath);
  if (!parentRelation) {
    return undefined;
  }

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const prevIndex = parentRelation.children
    .slice(0, relationIndex)
    .reduce<number>((found, childID, i) => {
      if (childID === EMPTY_SEMANTIC_ID) {
        return found;
      }
      const childRelation = getNode(
        data.knowledgeDBs,
        childID,
        data.user.publicKey
      );
      return childRelation && itemPassesFilters(childRelation, activeFilters)
        ? i
        : found;
    }, -1);

  if (prevIndex === -1) {
    return undefined;
  }

  try {
    const prevSiblingPath = addNodeToPath(data, parentPath, prevIndex, stack);
    const [prevItemID, prevView] = getRowIDFromView(data, prevSiblingPath);
    return {
      viewPath: prevSiblingPath,
      itemID: prevItemID,
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
  stack: ID[]
): ViewPath | undefined {
  const nodes = getRelationForView(data, viewPath, stack);
  if (!nodes || nodes.children.size === 0) {
    return undefined;
  }
  const lastIndex = nodes.children.size - 1;
  return addNodeToPathWithRelations(viewPath, nodes, lastIndex);
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getPreviousSibling(data, viewPath, stack);
}

export function RootViewContextProvider({
  children,
  root,
  paneIndex = 0,
  indices, // TODO: only used in tests, get rid of it
}: {
  children: React.ReactNode;
  root: ID;
  paneIndex?: number;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const stack = usePaneStack();
  const pane = data.panes[paneIndex];
  const rootContext = getContextFromStack(stack);
  const resolvedRootRelation = pane?.rootRelation
    ? getRelations(data.knowledgeDBs, pane.rootRelation, data.user.publicKey)
    : resolveSemanticRelationInCurrentTree(
        data.knowledgeDBs,
        pane?.author || data.user.publicKey,
        root,
        rootContext,
        undefined,
        true
      );
  const startPath: ViewPath = [paneIndex, resolvedRootRelation?.id || root];
  const finalPath = (indices || List<number>()).reduce(
    (acc, index) => addNodeToPath(data, acc, index, stack),
    startPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function useCurrentRowID(): [ID, View] {
  const data = useData();
  const viewPath = useViewPath();
  return getRowIDFromView(data, viewPath);
}

export function getDisplayTextForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentItem?: GraphNode
): string {
  const reference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType,
    currentItem
  );
  if (reference) {
    return reference.text;
  }
  const [itemID] = getRowIDFromView(data, viewPath);
  if (isSearchId(itemID as ID)) {
    const query = parseSearchId(itemID as ID) || "";
    return `Search: ${query}`;
  }
  const ownRelation = getRelationForView(data, viewPath, stack);
  const userPublicKey = getRelationUserPublicKey(ownRelation);
  const contactPetname = userPublicKey
    ? data.contacts.get(userPublicKey)?.userName
    : undefined;
  if (contactPetname) {
    return contactPetname;
  }
  return ownRelation?.text ?? "";
}

export function useDisplayText(): string {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const currentItem = useCurrentEdge();
  const virtualType = currentItem?.virtualType;
  return getDisplayTextForView(data, viewPath, stack, virtualType, currentItem);
}

export function getParentRowID(
  data: Data,
  viewPath: ViewPath
): [ID, View] | [undefined, undefined] {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return [undefined, undefined];
  }
  return getRowIDFromView(data, parentPath);
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
  return isRoot(useViewPath());
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const itemID = getLast(path);
  const defaultView = getDefaultView(itemID, isRoot(path));
  const isDefault = view.expanded === defaultView.expanded && !view.typeFilters;
  if (isDefault) {
    return views.delete(key);
  }
  return views.set(key, view);
}

export function deleteChildViews(views: Views, path: ViewPath): Views {
  const key = viewPathToString(path);
  return views.filter((_, k) => !k.startsWith(key) || k === key);
}

export function copyViewsWithNewPrefix(
  views: Views,
  sourceKey: string,
  targetKey: string
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const newKey = targetKey + key.slice(sourceKey.length);
    return acc.set(newKey, view);
  }, views);
}

export function copyViewsWithRelationsMapping(
  views: Views,
  sourceKey: string,
  targetKey: string,
  relationsIdMapping: Map<LongID, LongID>
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const suffix = key.slice(sourceKey.length);
    const mappedSuffix = relationsIdMapping.reduce(
      (s, newId, oldId) => s.split(oldId).join(newId),
      suffix
    );
    const newKey = targetKey + mappedSuffix;
    return acc.set(newKey, view);
  }, views);
}

export function upsertRelations(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  modify: (nodes: GraphNode) => GraphNode
): Plan {
  const semanticContext = getContext(plan, viewPath, stack);
  const parentRelation = getParentRelation(plan, viewPath);
  const parentRoot = parentRelation?.root;
  const currentRelation = getRelationForView(plan, viewPath, stack);

  if (currentRelation && currentRelation.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's nodes");
  }

  const base =
    currentRelation ||
    newRelations(
      "",
      semanticContext,
      plan.user.publicKey,
      parentRoot,
      parentRelation?.id
    );

  // Apply modification
  const updatedRelations = modify(base);

  // Skip event if children unchanged
  if (
    currentRelation &&
    currentRelation.children.equals(updatedRelations.children)
  ) {
    return plan;
  }

  return planUpsertRelations(plan, updatedRelations);
}

function pathContainsSubpath(
  path: ViewPath,
  subpath: ViewPathSegment[]
): boolean {
  if (subpath.length === 0 || path.length - 1 < subpath.length) {
    return false;
  }
  const segments = path.slice(1) as ViewPathSegment[];
  return segments.some((_, index) =>
    subpath.every((segment, offset) => segments[index + offset] === segment)
  );
}

export function updateViewPathsAfterMoveRelations(data: Data): Views {
  return data.views;
}

export function updateViewPathsAfterAddRelation(data: Data): Views {
  return data.views;
}

export function updateViewPathsAfterDeleteItem(
  views: Views,
  itemID: ID
): Views {
  return views.filterNot((_, k) => k.includes(itemID));
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: ID,
  fromRelation: LongID
): Views {
  return views.filterNot((_, key) => {
    try {
      return pathContainsSubpath(parseViewPath(key), [
        fromRelation,
        disconnectNode,
      ]);
    } catch {
      return false;
    }
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

export function bulkUpdateViewPathsAfterAddRelation(data: Data): Views {
  return data.views;
}
