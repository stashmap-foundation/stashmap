import { OrderedSet } from "immutable";
import {
  updateItemRelevance,
  updateItemArgument,
  isEmptyNodeID,
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
} from "../ViewContext";
import {
  Plan,
  planSaveNodeAndEnsureRelations,
  planUpdateEmptyNodeMetadata,
} from "../planner";

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
