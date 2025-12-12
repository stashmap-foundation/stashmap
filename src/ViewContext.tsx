import React from "react";
import { List, Set, Map } from "immutable";
import { v4 } from "uuid";
import {
  getRelations,
  isRemote,
  joinID,
  shortID,
  splitID,
} from "./connections";
import { newDB } from "./knowledge";
import { useData } from "./DataContext";
import { Plan, planUpsertRelations, planUpdateViews } from "./planner";
import { RELATION_TYPES } from "./components/RelationTypes";

// only exported for tests
export type NodeIndex = number & { readonly "": unique symbol };

export const ADD_TO_NODE = "ADD_TO_NODE" as LongID;

type SubPath = {
  nodeID: LongID | ID;
  nodeIndex: NodeIndex;
};

type SubPathWithRelations = SubPath & {
  relationsID: ID;
};

export type ViewPath =
  | readonly [SubPath]
  | readonly [...SubPathWithRelations[], SubPath];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 2) {
    throw new Error("Invalid view path");
  }
  const nodeIndexEnd = parseInt(pieces[pieces.length - 1], 10) as NodeIndex;
  const nodeIdEnd = pieces[pieces.length - 2] as LongID;

  const beginning = pieces
    .slice(0, -2)
    .reduce(
      (
        acc: SubPathWithRelations[],
        piece,
        index,
        subPaths
      ): SubPathWithRelations[] => {
        if (index % 3 === 0) {
          const nodeID = piece as LongID;
          const indexValue = parseInt(subPaths[index + 1], 10) as NodeIndex;
          const relationID = subPaths[index + 2];
          return [
            ...acc,
            { nodeID, nodeIndex: indexValue, relationsID: relationID },
          ];
        }
        return acc;
      },
      []
    );
  return [...beginning, { nodeID: nodeIdEnd, nodeIndex: nodeIndexEnd }];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const withoutLastElement = viewContext.slice(0, -1) as SubPathWithRelations[];
  const beginning = withoutLastElement.reduce(
    (acc: string, subPath: SubPathWithRelations): string => {
      const postfix = `${subPath.nodeID}:${subPath.nodeIndex}:${subPath.relationsID}`;
      return acc !== "" ? `${acc}:${postfix}` : postfix;
    },
    ""
  );
  const lastPath = viewContext[viewContext.length - 1];
  const end = `${lastPath.nodeID}:${lastPath.nodeIndex}`;
  return beginning !== "" ? `${beginning}:${end}` : end;
}

// TODO: delete this export
export const viewPathToString = convertViewPathToString;

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

function findIndexOfRelationType(types: RelationTypes, type: ID): number {
  return types.keySeq().findIndex((k) => k === type);
}

function sortRelationsAccordingToType(
  relations: List<Relations>
): List<Relations> {
  return relations.sort((a, b) => {
    const indexA = findIndexOfRelationType(RELATION_TYPES, a.type);
    const indexB = findIndexOfRelationType(RELATION_TYPES, b.type);
    if (indexA === undefined || indexB === undefined) {
      return 0;
    }
    return indexA - indexB;
  });
}

export function getAvailableRelationsForNode(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  id: LongID | ID
): List<Relations> {
  const myRelations = knowledgeDBs.get(myself, newDB()).relations;
  const [remote, localID] = splitID(id);
  const relations: List<Relations> = sortRelationsAccordingToType(
    myRelations.filter((r) => r.head === localID).toList()
  );

  const preferredRemoteRelations: List<Relations> =
    remote && isRemote(remote, myself)
      ? sortRelationsAccordingToType(
          knowledgeDBs
            .get(remote, newDB())
            .relations.filter((r) => r.head === localID)
            .toList()
        )
      : List<Relations>();
  const otherRelations: List<Relations> = knowledgeDBs
    .filter((_, k) => k !== myself && k !== remote)
    .map((db) =>
      sortRelationsAccordingToType(
        db.relations.filter((r) => r.head === localID).toList()
      )
    )
    .toList()
    .flatten(1) as List<Relations>;
  return relations.concat(preferredRemoteRelations).concat(otherRelations);
}

export function getDefaultRelationForNode(
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): LongID | undefined {
  return getAvailableRelationsForNode(knowledgeDBs, myself, id).first()?.id;
}

function getDefaultView(
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): View {
  return {
    relations: getDefaultRelationForNode(id, knowledgeDBs, myself),
    width: 1,
    expanded: false,
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
  const [remote, knowID] = splitID(id);
  const db = knowledgeDBs.get(remote || myself, newDB());
  const node = db.nodes.get(knowID);
  if (!node && remote === undefined) {
    return getNodeFromAnyDB(knowledgeDBs, knowID);
  }
  return node;
}

export function getLast(viewContext: ViewPath): SubPath {
  return viewContext[viewContext.length - 1];
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

export function getRelationsFromView(
  data: Data,
  viewPath: ViewPath
): Relations | undefined {
  const view = getViewFromPath(data, viewPath);
  return getRelations(
    data.knowledgeDBs,
    view.relations,
    data.user.publicKey,
    getLast(viewPath).nodeID
  );
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
  return relations.items.slice(0, index).filter((i) => i === item)
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
      if (item === node) {
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
): SubPathWithRelations[] {
  const pathWithoutParent = path.slice(0, -1) as SubPathWithRelations[];
  return [...pathWithoutParent, { ...getLast(path), relationsID }];
}

export function addAddToNodeToPath(data: Data, path: ViewPath): ViewPath {
  const relations = getRelationsFromView(data, path);
  // Assume there is only one Add to node per parent
  const nodeIndex = 0 as NodeIndex;
  return [
    ...addRelationsToLastElement(path, relations?.id || ("" as LongID)),
    { nodeID: ADD_TO_NODE, nodeIndex },
  ];
}

export function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number
): ViewPath {
  const relations = getRelationsFromView(data, path);
  if (!relations) {
    throw new Error("Parent doesn't have relations, cannot add to path");
  }
  const nodeID = relations.items.get(index);
  if (!nodeID) {
    // eslint-disable-next-line no-console
    console.error("No node found in relations", relations, " at index", index);
    throw new Error("No node found in relation at index");
  }
  const nodeIndex = calculateNodeIndex(relations, index);
  const pathWithRelations = addRelationsToLastElement(path, relations.id);
  return [...pathWithRelations, { nodeID, nodeIndex }];
}

function popPath(viewContext: ViewPath): ViewPath | undefined {
  const pathWithoutLast = viewContext.slice(0, -1) as SubPathWithRelations[];
  const parent = pathWithoutLast[pathWithoutLast.length - 1];
  if (!parent) {
    return undefined;
  }
  return [
    ...pathWithoutLast.slice(0, -1),
    { nodeID: parent.nodeID, nodeIndex: parent.nodeIndex },
  ];
}

export function getParentView(viewContext: ViewPath): ViewPath | undefined {
  return popPath(viewContext);
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
  const { nodeIndex, nodeID } = getLast(viewPath);
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }
  const relations = getRelationsFromView(data, parentPath);
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
  return getRelationIndex(data, path);
}

export function RootViewContextProvider({
  children,
  root,
  indices, // TODO: only used in tests, get rid of it
}: {
  children: React.ReactNode;
  root: LongID;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const startPath: ViewPath = [{ nodeID: root, nodeIndex: 0 as NodeIndex }];
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

export function useViewKey(): string {
  return viewPathToString(useViewPath());
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
  type: ID,
  myself: PublicKey
): Relations {
  return {
    head: shortID(head),
    items: List<LongID>(),
    id: joinID(myself, v4()),
    type,
    updated: Math.floor(Date.now() / 1000),
    author: myself,
  };
}

function createUpdatableRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  relationsID: ID,
  head: LongID | ID,
  relationTypeID: ID
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
      return newRelations(head, relationTypeID, myself);
    }
    // Make a copy
    return {
      ...remoteRelations,
      id: joinID(myself, v4()),
    };
  }
  return knowledgeDBs
    .get(myself, newDB())
    .relations.get(id, newRelations(head, relationTypeID, myself));
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

export function upsertRelations(
  plan: Plan,
  viewPath: ViewPath,
  modify: (relations: Relations) => Relations
): Plan {
  const [nodeID, nodeView] = getNodeIDFromView(plan, viewPath);
  // create new relations if this node doesn't have any
  const relationsID = nodeView.relations || v4();
  const relations = createUpdatableRelations(
    plan.knowledgeDBs,
    plan.user.publicKey,
    relationsID,
    nodeID,
    "" // TODO: relation type?
  );

  const didViewChange = nodeView.relations !== relations.id;
  const planWithUpdatedView = didViewChange
    ? planUpdateViews(
        plan,
        moveChildViewsToNewRelation(
          plan.views,
          viewPath,
          relationsID,
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
function getAllSubpaths(path: string): Set<string> {
  return path.split(":").reduce((acc, p) => {
    const lastPath = acc.last(undefined);
    return acc.add(lastPath ? `${lastPath}:${p}` : `${p}`);
  }, Set<string>());
}

function findViewsForRepo(
  data: Data,
  id: string,
  relationsID: ID
): Set<string> {
  // include partial, non existing views
  const paths = data.views.reduce((acc, _, path) => {
    return acc.merge(getAllSubpaths(path));
  }, Set<string>());
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
