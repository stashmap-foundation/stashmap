import {
  createRefTarget,
  createDocumentLinkTarget,
  isEmptySemanticID,
  getNode,
} from "./core/connections";
import {
  getBlockLinkTarget,
  isBlockFileLink,
  isBlockLink,
  nodeText,
} from "./core/nodeSpans";
import {
  documentKeyOf,
  documentLinkPath,
  getDocumentByIdOrFilePath,
} from "./core/Document";
import { planUpdateNodeItemMetadataById } from "./dataPlanner";
import { NodeItemMetadata, updateNodeItemMetadata } from "./nodeItemMetadata";
import {
  getParentView,
  getNodeForView,
  getNodeIndexForView,
  getRowIDFromView,
  viewPathToString,
  ViewPath,
  VirtualRowsMap,
} from "./ViewContext";
import {
  projectDocumentByFilePath,
  projectKnowledgeDBs,
} from "./core/graphData";
import {
  Plan,
  AddToParentTarget,
  getPane,
  planAddToParent,
  planAddTopTargetsToDocument,
  planDeepCopyNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
  planUpsertNodes,
} from "./planner";

export type { NodeItemMetadata } from "./nodeItemMetadata";

function getViewNodeText(plan: Plan, viewPath: ViewPath): string {
  const node = getNodeForView(plan, viewPath);
  return node ? nodeText(node) : "";
}

function planUpdateExistingItemMetadata(
  plan: Plan,
  parentViewPath: ViewPath,
  nodeIndex: number,
  metadata: NodeItemMetadata
): Plan {
  const nodes = getNodeForView(plan, parentViewPath);
  const itemId = nodes?.children.get(nodeIndex);
  return nodes && itemId
    ? planUpdateNodeItemMetadataById(plan, nodes.id, itemId, metadata)
    : plan;
}

function planUpdateDocumentTopNodeMetadata(
  plan: Plan,
  viewPath: ViewPath,
  metadata: NodeItemMetadata,
  editorText: string
): Plan {
  const pane = getPane(plan, viewPath);
  const currentNode = getNodeForView(plan, viewPath);
  if (
    pane.documentId === undefined ||
    !currentNode ||
    currentNode.parent ||
    !currentNode.docId ||
    currentNode.author !== plan.user.publicKey
  ) {
    return plan;
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== getViewNodeText(plan, viewPath)
      ? planSaveNodeAndEnsureNodes(plan, editorText, viewPath).plan
      : plan;
  const updatedNode = getNodeForView(basePlan, viewPath);

  return updatedNode
    ? planUpsertNodes(basePlan, updateNodeItemMetadata(updatedNode, metadata))
    : basePlan;
}

function getSourceDocumentTarget(
  plan: Plan,
  sourceRow: GraphNode
): ReturnType<typeof createDocumentLinkTarget> | undefined {
  const sourceRoot =
    sourceRow.id === sourceRow.root
      ? sourceRow
      : getNode(projectKnowledgeDBs(plan), sourceRow.root, sourceRow.author);
  if (!sourceRoot) {
    return undefined;
  }
  const sourceDocument = sourceRoot?.docId
    ? plan.documents.get(documentKeyOf(sourceRoot.author, sourceRoot.docId))
    : undefined;
  return sourceDocument
    ? createDocumentLinkTarget(
        sourceDocument.author,
        sourceDocument.docId,
        documentLinkPath(sourceDocument),
        nodeText(sourceRoot) || sourceDocument.title
      )
    : undefined;
}

function getBlockLinkInsertTarget(
  plan: Plan,
  sourceRow: GraphNode
): AddToParentTarget | undefined {
  const targetID = getBlockLinkTarget(sourceRow);
  if (targetID) {
    return createRefTarget(targetID);
  }
  return isBlockFileLink(sourceRow)
    ? getSourceDocumentTarget(plan, sourceRow)
    : undefined;
}

function getIncomingFileLinkSource(
  plan: Plan,
  virtualRow: GraphNode
): GraphNode | undefined {
  if (virtualRow.virtualType !== "incoming") {
    return undefined;
  }
  const sourceID = getBlockLinkTarget(virtualRow) ?? virtualRow.id;
  const sourceRow = getNode(
    projectKnowledgeDBs(plan),
    sourceID,
    plan.user.publicKey
  );
  return isBlockFileLink(sourceRow) ? sourceRow : undefined;
}

function planAcceptDocumentTopIncoming(
  plan: Plan,
  viewPath: ViewPath,
  metadata: NodeItemMetadata,
  virtualRowsMap?: VirtualRowsMap
): Plan | undefined {
  const pane = getPane(plan, viewPath);
  const parentView = getParentView(viewPath);
  const isDocumentTopLevel =
    !parentView || getParentView(parentView) === undefined;
  const document = pane.documentId
    ? getDocumentByIdOrFilePath(
        plan.documents,
        projectDocumentByFilePath(plan),
        pane.author,
        pane.documentId
      )
    : undefined;
  const virtualRow = virtualRowsMap?.get(viewPathToString(viewPath));
  if (
    !isDocumentTopLevel ||
    !document ||
    virtualRow?.virtualType !== "incoming"
  ) {
    return undefined;
  }
  const sourceRow = getNode(
    projectKnowledgeDBs(plan),
    virtualRow.id,
    plan.user.publicKey
  );
  if (!sourceRow || !isBlockFileLink(sourceRow)) {
    return undefined;
  }
  const target = getBlockLinkInsertTarget(plan, sourceRow);
  return target
    ? planAddTopTargetsToDocument(
        plan,
        document,
        target,
        metadata.relevance,
        metadata.argument
      )[0]
    : undefined;
}

export function planUpdateViewItemMetadata(
  plan: Plan,
  viewPath: ViewPath,
  metadata: NodeItemMetadata,
  editorText: string,
  virtualRowsMap?: VirtualRowsMap
): Plan {
  const [rowID] = getRowIDFromView(plan, viewPath);
  const documentTopIncomingPlan = planAcceptDocumentTopIncoming(
    plan,
    viewPath,
    metadata,
    virtualRowsMap
  );
  if (documentTopIncomingPlan) {
    return documentTopIncomingPlan;
  }
  const parentView = getParentView(viewPath);
  if (!parentView) {
    return planUpdateDocumentTopNodeMetadata(
      plan,
      viewPath,
      metadata,
      editorText
    );
  }

  if (isEmptySemanticID(rowID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      return planSaveNodeAndEnsureNodes(
        plan,
        trimmed,
        viewPath,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    const nodes = getNodeForView(plan, parentView);
    return nodes ? planUpdateEmptyNodeMetadata(plan, nodes.id, metadata) : plan;
  }

  const nodeIndex = getNodeIndexForView(plan, viewPath);
  if (nodeIndex === undefined) {
    const virtualRow = virtualRowsMap?.get(viewPathToString(viewPath));
    if (!virtualRow) {
      return plan;
    }
    if (virtualRow.virtualType === "suggestion" && !isBlockLink(virtualRow)) {
      return planDeepCopyNode(
        plan,
        viewPath,
        parentView,
        undefined,
        metadata.relevance,
        metadata.argument
      )[0];
    }
    const incomingFileLinkSource = getIncomingFileLinkSource(plan, virtualRow);
    const targetItem =
      (incomingFileLinkSource
        ? getBlockLinkInsertTarget(plan, incomingFileLinkSource)
        : undefined) ??
      getBlockLinkInsertTarget(plan, virtualRow) ??
      rowID;
    const targetID = getBlockLinkTarget(virtualRow);
    const inheritedSourceNode = targetID
      ? getNode(projectKnowledgeDBs(plan), targetID, plan.user.publicKey)
      : undefined;
    return planAddToParent(
      plan,
      targetItem,
      parentView,
      undefined,
      metadata.relevance ?? inheritedSourceNode?.relevance,
      metadata.argument ?? inheritedSourceNode?.argument
    )[0];
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== getViewNodeText(plan, viewPath)
      ? planSaveNodeAndEnsureNodes(plan, editorText, viewPath).plan
      : plan;

  return planUpdateExistingItemMetadata(
    basePlan,
    parentView,
    nodeIndex,
    metadata
  );
}
