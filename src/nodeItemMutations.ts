import { LOCAL } from "./core/nodeRef";
import {
  createRefTarget,
  createDocumentLinkTarget,
  isEmptyNodeID,
  getNode,
} from "./core/connections";
import {
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockFileLink,
  isBlockLink,
  nodeText,
  spansText,
  spansToMarkdown,
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
    nodeID: ID;
    viewPath: ViewPath;
    paneIndex: number;
    documentId: string | undefined;
  },
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  const { node, nodeID, viewPath, paneIndex, documentId } = input;
  if (documentId === undefined || node.parent || !node.docId) {
    return plan;
  }

  const basePlan =
    editorSpans &&
    spansText(editorSpans).trim() !== "" &&
    spansToMarkdown(editorSpans) !== spansToMarkdown(node.spans)
      ? planSaveNodeAndEnsureNodes(
          plan,
          editorSpans,
          nodeID,
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

export function planUpdateViewItemMetadata(
  plan: Plan,
  input: {
    node: GraphNode;
    nodeID: ID;
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
  editorSpans: InlineSpan[] | undefined
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
    nodeID,
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
      { node, nodeID, viewPath, paneIndex, documentId },
      metadata,
      editorSpans
    );
  }

  if (isEmptyNodeID(nodeID)) {
    if (editorSpans && spansText(editorSpans).trim() !== "") {
      return planSaveNodeAndEnsureNodes(
        plan,
        editorSpans,
        nodeID,
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
      return planDeepCopyNode(
        plan,
        input.sourceId,
        node,
        parentNode.id,
        viewPath,
        parentViewPath,
        undefined,
        metadata.relevance,
        metadata.argument
      );
    }
    // Incoming references route through the materialization seam
    // (planMaterializeComputedRow with their prepared take) before this
    // function is ever reached; what remains here serves versions and
    // block-link suggestions.
    const targetItem = getBlockLinkInsertTarget(plan, node) ?? nodeID;
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

  const basePlan =
    editorSpans &&
    spansText(editorSpans).trim() !== "" &&
    spansToMarkdown(editorSpans) !== spansToMarkdown(node.spans)
      ? planSaveNodeAndEnsureNodes(
          plan,
          editorSpans,
          nodeID,
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
