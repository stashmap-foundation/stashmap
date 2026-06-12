import { LOCAL } from "./core/nodeRef";
import {
  createRefTarget,
  createDocumentLinkTarget,
  isEmptySemanticID,
  getNode,
  getNodeContext,
  getSemanticID,
  resolveNode,
  isRefNode,
} from "./core/connections";
import {
  getBlockLinkTarget,
  getBlockLinkText,
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
import { ViewPath } from "./rowModel";
import {
  Plan,
  AddToParentTarget,
  planAddToParent,
  planAddTopTargetsToDocument,
  planDeepCopyNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
  planUpsertNodes,
} from "./planner";

export type { NodeItemMetadata } from "./nodeItemMetadata";

function planUpdateExistingItemMetadata(
  plan: Plan,
  parentNode: GraphNode,
  nodeIndex: number,
  metadata: NodeItemMetadata
): Plan {
  const itemId = parentNode.children.get(nodeIndex);
  return itemId
    ? planUpdateNodeItemMetadataById(plan, parentNode.id, itemId, metadata)
    : plan;
}

function planUpdateDocumentTopNodeMetadata(
  plan: Plan,
  input: {
    node: GraphNode;
    rowID: ID;
    viewPath: ViewPath;
    paneIndex: number;
    documentId: string | undefined;
  },
  metadata: NodeItemMetadata,
  editorText: string
): Plan {
  const { node, rowID, viewPath, paneIndex, documentId } = input;
  if (documentId === undefined || node.parent || !node.docId) {
    return plan;
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== nodeText(node)
      ? planSaveNodeAndEnsureNodes(
          plan,
          editorText,
          rowID,
          node,
          viewPath,
          undefined,
          undefined,
          paneIndex
        ).plan
      : plan;
  const updatedNode = getNode(basePlan.knowledgeDBs, node.id, LOCAL);

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
      : getNode(plan.knowledgeDBs, sourceRow.root, LOCAL);
  if (!sourceRoot) {
    return undefined;
  }
  const sourceDocument = sourceRoot?.docId
    ? plan.documents.get(documentKeyOf(LOCAL, sourceRoot.docId))
    : undefined;
  return sourceDocument
    ? createDocumentLinkTarget(
        sourceDocument.sourceId,
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
    return createRefTarget(targetID, getBlockLinkText(sourceRow));
  }
  return isBlockFileLink(sourceRow)
    ? getSourceDocumentTarget(plan, sourceRow)
    : undefined;
}

function getIncomingFileLinkSource(
  plan: Plan,
  node: GraphNode,
  virtualType: Row["virtualType"]
): GraphNode | undefined {
  if (virtualType !== "incoming") {
    return undefined;
  }
  const sourceID = getBlockLinkTarget(node) ?? node.id;
  const sourceRow = getNode(plan.knowledgeDBs, sourceID, LOCAL);
  return isBlockFileLink(sourceRow) ? sourceRow : undefined;
}

function planAcceptDocumentTopIncoming(
  plan: Plan,
  input: {
    node: GraphNode;
    virtualType: Row["virtualType"];
    paneAuthor: SourceId;
    documentId: string | undefined;
    isDocumentTopLevel: boolean;
  },
  metadata: NodeItemMetadata
): Plan | undefined {
  const { node, virtualType, paneAuthor, documentId, isDocumentTopLevel } =
    input;
  const document = documentId
    ? getDocumentByIdOrFilePath(
        plan.documents,
        plan.documentByFilePath,
        paneAuthor,
        documentId
      )
    : undefined;
  if (!isDocumentTopLevel || !document || virtualType !== "incoming") {
    return undefined;
  }
  const sourceRow = getNode(plan.knowledgeDBs, node.id, LOCAL);
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

function resolveDeepCopySource(
  plan: Plan,
  rowID: ID,
  node: GraphNode,
  sourceId: SourceId
): {
  itemID: ID;
  semanticContext: Context;
  node: GraphNode;
  sourceId: SourceId;
} {
  if (isRefNode(node)) {
    const resolved = resolveNode(plan.knowledgeDBs, node, sourceId);
    if (resolved) {
      return {
        itemID: getSemanticID(plan.knowledgeDBs, resolved, sourceId),
        semanticContext: getNodeContext(plan.knowledgeDBs, resolved, sourceId),
        node: resolved,
        sourceId,
      };
    }
  }
  return {
    itemID: rowID,
    semanticContext: getNodeContext(plan.knowledgeDBs, node, sourceId),
    node,
    sourceId,
  };
}

export function planUpdateViewItemMetadata(
  plan: Plan,
  input: {
    node: GraphNode;
    rowID: ID;
    sourceId: SourceId;
    viewPath: ViewPath;
    parentNode: GraphNode | undefined;
    parentViewPath: ViewPath | undefined;
    childIndex: number | undefined;
    virtualType: Row["virtualType"];
    paneIndex: number;
    paneAuthor: SourceId;
    documentId: string | undefined;
    isDocumentTopLevel: boolean;
  },
  metadata: NodeItemMetadata,
  editorText: string
): Plan {
  const documentTopIncomingPlan = planAcceptDocumentTopIncoming(
    plan,
    input,
    metadata
  );
  if (documentTopIncomingPlan) {
    return documentTopIncomingPlan;
  }

  const {
    node,
    rowID,
    viewPath,
    parentNode,
    parentViewPath,
    childIndex,
    virtualType,
    paneIndex,
    documentId,
  } = input;

  if (!parentViewPath) {
    return planUpdateDocumentTopNodeMetadata(
      plan,
      { node, rowID, viewPath, paneIndex, documentId },
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
        rowID,
        node,
        viewPath,
        parentNode,
        parentViewPath,
        paneIndex,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    return parentNode
      ? planUpdateEmptyNodeMetadata(plan, parentNode.id, metadata)
      : plan;
  }

  if (childIndex === undefined) {
    if (!virtualType || !parentNode) {
      return plan;
    }
    if (virtualType === "suggestion" && !isBlockLink(node)) {
      const source = resolveDeepCopySource(plan, rowID, node, input.sourceId);
      return planDeepCopyNode(
        plan,
        source.sourceId,
        source.node,
        parentNode.id,
        viewPath,
        parentViewPath,
        undefined,
        metadata.relevance,
        metadata.argument
      );
    }
    const incomingFileLinkSource = getIncomingFileLinkSource(
      plan,
      node,
      virtualType
    );
    const targetItem =
      (incomingFileLinkSource
        ? getBlockLinkInsertTarget(plan, incomingFileLinkSource)
        : undefined) ??
      getBlockLinkInsertTarget(plan, node) ??
      rowID;
    const targetID = getBlockLinkTarget(node);
    const inheritedSourceNode = targetID
      ? getNode(plan.knowledgeDBs, targetID, LOCAL)
      : undefined;
    return planAddToParent(
      plan,
      targetItem,
      parentNode.id,
      undefined,
      metadata.relevance ?? inheritedSourceNode?.relevance,
      metadata.argument ?? inheritedSourceNode?.argument
    )[0];
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== nodeText(node)
      ? planSaveNodeAndEnsureNodes(
          plan,
          editorText,
          rowID,
          node,
          viewPath,
          parentNode,
          parentViewPath,
          paneIndex
        ).plan
      : plan;

  return parentNode
    ? planUpdateExistingItemMetadata(basePlan, parentNode, childIndex, metadata)
    : basePlan;
}
