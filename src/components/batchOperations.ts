import { OrderedSet } from "immutable";
import {
  updateItemRelevance,
  updateItemArgument,
  isEmptyNodeID,
  shortID,
} from "../connections";
import {
  ViewPath,
  getParentView,
  getParentRelation,
  getRelationIndex,
  upsertRelations,
  getLast,
  getRelationForView,
  viewPathToString,
  getParentKey,
  parseViewPath,
  getPreviousSibling,
  getContext,
} from "../ViewContext";
import {
  Plan,
  planExpandNode,
  planCreateVersion,
  planSaveNodeAndEnsureRelations,
  planUpdateEmptyNodeMetadata,
} from "../planner";
import { planMoveNodeWithView } from "../dnd";

export type EditorInfo = {
  text: string;
  viewPath: ViewPath;
};

export function getCurrentItem(
  data: Data,
  viewPath: ViewPath
): RelationItem | undefined {
  const parentView = getParentView(viewPath);
  if (!parentView) return undefined;
  const relations = getParentRelation(data, viewPath);
  const relationIndex = getRelationIndex(data, viewPath);
  if (!relations || relationIndex === undefined) return undefined;
  return relations.items.get(relationIndex);
}

function planClearSelection(plan: Plan): Plan {
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      baseSelection: OrderedSet<string>(),
      shiftSelection: OrderedSet<string>(),
    },
  };
}

function getEditorTextForPath(
  editorInfo: EditorInfo | undefined,
  viewPath: ViewPath
): string {
  if (!editorInfo) return "";
  if (viewPathToString(editorInfo.viewPath) !== viewPathToString(viewPath))
    return "";
  return editorInfo.text;
}

function getNodeText(plan: Plan, nodeID: ID | LongID): string {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey);
  if (!userDB) return "";
  const node = userDB.nodes.get(nodeID as ID);
  return node?.text ?? "";
}

function planUpdateOneRelevance(
  acc: Plan,
  viewPath: ViewPath,
  stack: ID[],
  relevance: Relevance,
  editorText: string
): Plan {
  const { nodeID } = getLast(viewPath);
  const parentView = getParentView(viewPath);
  if (!parentView) return acc;

  if (isEmptyNodeID(nodeID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      const { plan } = planSaveNodeAndEnsureRelations(
        acc,
        trimmed,
        viewPath,
        stack,
        relevance
      );
      return plan;
    }
    const relations = getRelationForView(acc, parentView, stack);
    if (!relations) return acc;
    return planUpdateEmptyNodeMetadata(acc, relations.id, { relevance });
  }

  const relationIndex = getRelationIndex(acc, viewPath);
  if (relationIndex === undefined) return acc;

  const basePlan =
    editorText.trim() && editorText !== getNodeText(acc, nodeID)
      ? planSaveNodeAndEnsureRelations(acc, editorText, viewPath, stack).plan
      : acc;

  return upsertRelations(basePlan, parentView, stack, (rels) =>
    updateItemRelevance(rels, relationIndex, relevance)
  );
}

function planUpdateOneArgument(
  acc: Plan,
  viewPath: ViewPath,
  stack: ID[],
  argument: Argument,
  editorText: string
): Plan {
  const { nodeID } = getLast(viewPath);
  const parentView = getParentView(viewPath);
  if (!parentView) return acc;

  if (isEmptyNodeID(nodeID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      const { plan } = planSaveNodeAndEnsureRelations(
        acc,
        trimmed,
        viewPath,
        stack,
        undefined,
        argument
      );
      return plan;
    }
    const relations = getRelationForView(acc, parentView, stack);
    if (!relations) return acc;
    return planUpdateEmptyNodeMetadata(acc, relations.id, { argument });
  }

  const relationIndex = getRelationIndex(acc, viewPath);
  if (relationIndex === undefined) return acc;

  const basePlan =
    editorText.trim() && editorText !== getNodeText(acc, nodeID)
      ? planSaveNodeAndEnsureRelations(acc, editorText, viewPath, stack).plan
      : acc;

  return upsertRelations(basePlan, parentView, stack, (rels) =>
    updateItemArgument(rels, relationIndex, argument)
  );
}

export function planBatchRelevance(
  plan: Plan,
  viewPaths: ViewPath[],
  stack: ID[],
  relevance: Relevance,
  editorInfo?: EditorInfo
): Plan {
  const updated = viewPaths.reduce(
    (acc, viewPath) =>
      planUpdateOneRelevance(
        acc,
        viewPath,
        stack,
        relevance,
        getEditorTextForPath(editorInfo, viewPath)
      ),
    plan
  );
  return planClearSelection(updated);
}

export function planBatchArgument(
  plan: Plan,
  viewPaths: ViewPath[],
  stack: ID[],
  argument: Argument,
  editorInfo?: EditorInfo
): Plan {
  const updated = viewPaths.reduce(
    (acc, viewPath) =>
      planUpdateOneArgument(
        acc,
        viewPath,
        stack,
        argument,
        getEditorTextForPath(editorInfo, viewPath)
      ),
    plan
  );
  return planClearSelection(updated);
}

function allSameParent(viewKeys: string[]): boolean {
  if (viewKeys.length === 0) return false;
  const firstParent = getParentKey(viewKeys[0]);
  return viewKeys.every((k) => getParentKey(k) === firstParent);
}

function sortByRelationIndex(plan: Plan, viewPaths: ViewPath[]): ViewPath[] {
  return [...viewPaths].sort((a, b) => {
    const idxA = getRelationIndex(plan, a) ?? 0;
    const idxB = getRelationIndex(plan, b) ?? 0;
    return idxA - idxB;
  });
}

export function planBatchIndent(
  plan: Plan,
  viewKeys: string[],
  stack: ID[],
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(viewKeys)) return undefined;

  const viewPaths = sortByRelationIndex(plan, viewKeys.map(parseViewPath));
  const firstPath = viewPaths[0];

  const prevSibling = getPreviousSibling(plan, firstPath, stack);
  if (!prevSibling) return undefined;

  const planWithExpand = planExpandNode(
    plan,
    prevSibling.view,
    prevSibling.viewPath
  );

  const prevSiblingContext = getContext(plan, prevSibling.viewPath, stack);
  const newContext = prevSiblingContext.push(shortID(prevSibling.nodeID));

  const updated = viewPaths.reduce((acc, viewPath) => {
    const moved = planMoveNodeWithView(
      acc,
      viewPath,
      prevSibling.viewPath,
      stack
    );
    const editorText = getEditorTextForPath(editorInfo, viewPath);
    if (!editorText) return moved;
    const { nodeID } = getLast(viewPath);
    const nodeText = getNodeText(acc, nodeID);
    if (editorText === nodeText) return moved;
    return planCreateVersion(moved, nodeID, editorText, newContext);
  }, planWithExpand);

  return planClearSelection(updated);
}

export function planBatchOutdent(
  plan: Plan,
  viewKeys: string[],
  stack: ID[],
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(viewKeys)) return undefined;

  const viewPaths = sortByRelationIndex(plan, viewKeys.map(parseViewPath));
  const firstPath = viewPaths[0];
  const parentPath = getParentView(firstPath);
  if (!parentPath) return undefined;

  const grandParentPath = getParentView(parentPath);
  if (!grandParentPath) return undefined;

  const parentRelationIndex = getRelationIndex(plan, parentPath);
  if (parentRelationIndex === undefined) return undefined;

  const grandParentContext = getContext(plan, grandParentPath, stack);
  const grandParentNodeID = getLast(grandParentPath).nodeID;
  const newContext = grandParentContext.push(shortID(grandParentNodeID));

  const updated = viewPaths.reduce((acc, viewPath, idx) => {
    const moved = planMoveNodeWithView(
      acc,
      viewPath,
      grandParentPath,
      stack,
      parentRelationIndex + 1 + idx
    );
    const editorText = getEditorTextForPath(editorInfo, viewPath);
    if (!editorText) return moved;
    const { nodeID } = getLast(viewPath);
    const nodeText = getNodeText(acc, nodeID);
    if (editorText === nodeText) return moved;
    return planCreateVersion(moved, nodeID, editorText, newContext);
  }, plan);

  return planClearSelection(updated);
}
