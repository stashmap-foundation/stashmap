/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { List, Map } from "immutable";
import {
  getRelations,
  getRelationsNoReferencedBy,
  shortID,
  isRefId,
  isSearchId,
  parseSearchId,
  itemMatchesType,
  EMPTY_SEMANTIC_ID,
  isConcreteRefId,
  itemPassesFilters,
  getRelationContext,
  getRelationSemanticID,
  getRefLinkTargetInfo,
  getRefTargetInfo,
} from "./connections";
import { buildReferenceItem } from "./buildReferenceRow";
import { resolveSemanticRelationInCurrentTree } from "./semanticNavigation";
import { useData } from "./DataContext";
import { Plan, planUpsertRelations, getPane } from "./planner";
import { usePaneStack } from "./SplitPanesContext";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { newRelations } from "./relationFactory";

export { newRelations } from "./relationFactory";

type ViewPathSegment = LongID | ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export type VirtualItemsMap = Map<string, RelationItem>;

const VirtualItemsContext = React.createContext<VirtualItemsMap>(
  Map<string, RelationItem>()
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

function isEmptyViewPathID(id: LongID | ID): boolean {
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
    return parentContext.push(getRelationSemanticID(parentRelation));
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
  id: LongID | ID,
  myself: PublicKey
): Relations | undefined {
  return getRelationsNoReferencedBy(knowledgeDBs, id, myself);
}

function getRowIDFromPath(data: Data, viewPath: ViewPath): LongID | ID {
  const currentID = getLast(viewPath);
  if (isEmptyViewPathID(currentID)) {
    return EMPTY_SEMANTIC_ID;
  }
  if (isConcreteRefId(currentID)) {
    return currentID;
  }
  return getRelationsNoReferencedBy(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  )
    ? getRelationSemanticID(
        getRelationsNoReferencedBy(
          data.knowledgeDBs,
          currentID,
          data.user.publicKey
        ) as Relations
      )
    : currentID;
}

export function getRowIDFromView(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] {
  const view = getViewFromPath(data, viewPath);
  return [getRowIDFromPath(data, viewPath), view];
}

export function getRowIDsForViewPath(
  data: Data,
  viewPath: ViewPath
): Array<LongID | ID> {
  const paneIndex = getPaneIndex(viewPath);
  return (viewPath.slice(1) as ViewPathSegment[]).map((_, index, segments) =>
    getRowIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
}

export function getParentRelation(
  data: Data,
  viewPath: ViewPath
): Relations | undefined {
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
): Relations | undefined {
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
  paneStack: ID[]
): {
  stack: ID[];
  author: PublicKey;
  rootRelation?: LongID;
  scrollToId?: string;
} {
  const [itemID] = getRowIDFromView(data, viewPath);
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const virtualType = getCurrentEdgeForView(data, viewPath)?.virtualType;
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    paneStack,
    virtualType
  );
  const refInfo = (() => {
    if (!currentReference) {
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
  | "occurrence"
  | "contains"
)[];

/**
 * Filter relation items by type filters.
 */
export function filterRelationItems(
  items: List<RelationItem>,
  filters: TypeFilters
): List<RelationItem> {
  const itemFilters = filters.filter(
    (f): f is Relevance | Argument | "contains" =>
      f !== "suggestions" && f !== undefined
  );
  return items.filter((item) =>
    itemFilters.some((f) => itemMatchesType(item, f))
  );
}

export function getCurrentReferenceForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): ReferenceRow | undefined {
  const [itemID] = getRowIDFromView(data, viewPath);
  if (!isRefId(itemID)) {
    return undefined;
  }
  return buildReferenceItem(
    itemID as LongID,
    data,
    viewPath,
    stack,
    virtualType
  );
}

export function addRelationsToLastElement(
  path: ViewPath,
  relationsID: LongID
): ViewPath {
  const last = getLast(path);
  if (last === relationsID || isConcreteRefId(last)) {
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
  relations: Relations,
  index: number
): ViewPath {
  const item = relations.items.get(index);
  if (!item) {
    throw new Error("No node found in relation at index");
  }
  const pathWithRelations = addRelationsToLastElement(path, relations.id);
  const nextSegment =
    item.id === EMPTY_SEMANTIC_ID
      ? createEmptyViewPathID(relations.id)
      : item.id;
  return [...pathWithRelations, nextSegment] as ViewPath;
}

export function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number,
  stack: ID[]
): ViewPath {
  const relations = getRelationForView(data, path, stack);
  if (!relations) {
    throw new Error("Parent doesn't have relations, cannot add to path");
  }
  return addNodeToPathWithRelations(path, relations, index);
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const viewPath = useViewPath();
  return getEffectiveAuthor(data, viewPath);
}

export function useCurrentRelation(): Relations | undefined {
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
  const relations = getParentRelation(data, viewPath);
  if (!relations) {
    return undefined;
  }
  const itemID = getLast(viewPath);
  const index = relations.items.findIndex(
    (item) =>
      item.id === itemID ||
      (item.id === EMPTY_SEMANTIC_ID && isEmptyViewPathID(itemID))
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
): RelationItem | undefined {
  const relation = getParentRelation(data, viewPath);
  if (!relation) {
    return undefined;
  }
  const index = getRelationIndex(data, viewPath);
  return index !== undefined ? relation.items.get(index) : undefined;
}

export function useCurrentEdge(): RelationItem | undefined {
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
  itemID: LongID | ID;
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

  const prevIndex = parentRelation.items
    .slice(0, relationIndex)
    .reduce<number>(
      (found, item, i) => (itemPassesFilters(item, activeFilters) ? i : found),
      -1
    );

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
  root: LongID | ID;
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

export function useCurrentRowID(): [LongID | ID, View] {
  const data = useData();
  const viewPath = useViewPath();
  return getRowIDFromView(data, viewPath);
}

export function getDisplayTextForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): string {
  const reference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType
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
  return ownRelation?.text ?? "";
}

export function useDisplayText(): string {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const virtualType = useCurrentEdge()?.virtualType;
  return getDisplayTextForView(data, viewPath, stack, virtualType);
}

export function getParentRowID(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] | [undefined, undefined] {
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
  modify: (relations: Relations) => Relations
): Plan {
  const semanticContext = getContext(plan, viewPath, stack);
  const parentRelation = getParentRelation(plan, viewPath);
  const parentRoot = parentRelation?.root;
  const currentRelation = getRelationForView(plan, viewPath, stack);

  if (currentRelation && currentRelation.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's relations");
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

  // Skip event if items unchanged
  if (currentRelation && currentRelation.items.equals(updatedRelations.items)) {
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
  itemID: LongID | ID
): Views {
  return views.filterNot((_, k) => k.includes(itemID));
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: LongID | ID,
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
