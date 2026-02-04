import { List } from "immutable";
import {
  ViewPath,
  NodeIndex,
  addNodeToPathWithRelations,
  addRelationsToLastElement,
  getDiffItemsForNode,
  getNodeIDFromView,
  getContext,
  getRelationsForContext,
  getParentView,
  isRoot,
  isReferencedByView,
  getEffectiveAuthor,
} from "./ViewContext";
import {
  getReferencedByRelations,
  getConcreteRefsForAbstract,
  isAbstractRefId,
  isConcreteRefId,
  isSearchId,
  getRelations,
} from "./connections";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { getPane } from "./planner";

function getChildrenForAbstractRef(
  data: Data,
  parentPath: ViewPath,
  parentNodeID: LongID | ID
): List<ViewPath> {
  const relations = getConcreteRefsForAbstract(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID as LongID
  );
  if (!relations || relations.items.size === 0) {
    return List();
  }
  return relations.items
    .map((_, i) => addNodeToPathWithRelations(parentPath, relations, i))
    .toList();
}

function getChildrenForConcreteRef(
  data: Data,
  parentPath: ViewPath,
  parentNodeID: LongID | ID
): List<ViewPath> {
  const sourceRelation = getRelations(
    data.knowledgeDBs,
    parentNodeID,
    data.user.publicKey,
    parentNodeID
  );
  if (!sourceRelation || sourceRelation.items.size === 0) {
    return List();
  }

  return sourceRelation.items
    .map((_, i) => addNodeToPathWithRelations(parentPath, sourceRelation, i))
    .toList();
}

function getChildrenForReferencedBy(
  data: Data,
  parentPath: ViewPath,
  parentNodeID: LongID | ID,
  grandparentPath: ViewPath | undefined,
  isGrandchildOfSearch: boolean
): List<ViewPath> {
  const relations = getReferencedByRelations(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID
  );
  if (!relations || relations.items.size === 0) {
    return List();
  }
  const refParentPath =
    isGrandchildOfSearch && grandparentPath ? grandparentPath : parentPath;
  return relations.items
    .map((_, i) => addNodeToPathWithRelations(refParentPath, relations, i))
    .toList();
}

function itemPassesFilters(
  item: RelationItem,
  activeFilters: (Relevance | Argument | "suggestions" | "contains")[]
): boolean {
  const hasArgumentFilter =
    activeFilters.includes("confirms") || activeFilters.includes("contra");

  if (hasArgumentFilter) {
    const matchesArgument =
      (activeFilters.includes("confirms") && item.argument === "confirms") ||
      (activeFilters.includes("contra") && item.argument === "contra");
    if (!matchesArgument) return false;
  }

  const relevance = item.relevance;
  if (relevance !== undefined && !activeFilters.includes(relevance)) {
    return false;
  }

  if (relevance === undefined && item.argument === undefined) {
    if (!activeFilters.includes("contains")) return false;
  }

  return true;
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentNodeID: LongID | ID,
  stack: ID[],
  rootRelation: LongID | undefined
): List<ViewPath> {
  const author = getEffectiveAuthor(data, parentPath);
  const context = getContext(data, parentPath, stack);
  const pane = getPane(data, parentPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const relations = isSearchId(parentNodeID as ID)
    ? getRelations(
        data.knowledgeDBs,
        parentNodeID as ID,
        data.user.publicKey,
        parentNodeID
      )
    : getRelationsForContext(
        data.knowledgeDBs,
        author,
        parentNodeID,
        context,
        rootRelation,
        isRoot(parentPath)
      );

  const relationPaths = relations
    ? relations.items
        .map((item, i) => ({ item, index: i }))
        .filter(({ item }) => itemPassesFilters(item, activeFilters))
        .map(({ index }) =>
          addNodeToPathWithRelations(parentPath, relations, index)
        )
        .toList()
    : List<ViewPath>();

  const diffItems = getDiffItemsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID,
    activeFilters,
    relations?.id,
    context
  );

  const diffPaths = diffItems.map((suggestionId, idx) => {
    const pathWithRelations = addRelationsToLastElement(
      parentPath,
      relations?.id || ("" as LongID)
    );
    return [
      ...pathWithRelations,
      { nodeID: suggestionId, nodeIndex: idx as NodeIndex },
    ] as ViewPath;
  });

  return relationPaths.concat(diffPaths);
}

function getChildNodes(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  rootRelation: LongID | undefined
): List<ViewPath> {
  const [parentNodeID, parentView] = getNodeIDFromView(data, parentPath);

  if (isAbstractRefId(parentNodeID)) {
    return getChildrenForAbstractRef(data, parentPath, parentNodeID);
  }

  if (isConcreteRefId(parentNodeID)) {
    return getChildrenForConcreteRef(data, parentPath, parentNodeID);
  }

  const grandparentPath = getParentView(parentPath);
  const [grandparentNodeID] = grandparentPath
    ? getNodeIDFromView(data, grandparentPath)
    : [undefined];
  const isGrandchildOfSearch =
    grandparentNodeID && isSearchId(grandparentNodeID as ID);

  if (isReferencedByView(parentView) || isGrandchildOfSearch) {
    return getChildrenForReferencedBy(
      data,
      parentPath,
      parentNodeID,
      grandparentPath,
      !!isGrandchildOfSearch
    );
  }

  return getChildrenForRegularNode(
    data,
    parentPath,
    parentNodeID,
    stack,
    rootRelation
  );
}

export function getNodesInTree(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  ctx: List<ViewPath>,
  rootRelation: LongID | undefined
): List<ViewPath> {
  const [parentNodeID] = getNodeIDFromView(data, parentPath);
  const isSearch = isSearchId(parentNodeID as ID);
  const children = getChildNodes(data, parentPath, stack, rootRelation);

  return children.reduce((result, childPath) => {
    const [, childView] = getNodeIDFromView(data, childPath);
    const skipAddingChild = isSearch;
    const withChild = skipAddingChild ? result : result.push(childPath);

    if (childView.expanded || isSearch) {
      return getNodesInTree(data, childPath, stack, withChild, rootRelation);
    }
    return withChild;
  }, ctx);
}
