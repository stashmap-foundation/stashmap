import { LOCAL } from "./core/nodeRef";
import { isEmptyNodeID, getNode } from "./core/connections";
import { spansText, spansToMarkdown } from "./core/nodeSpans";
import { planUpdateNodeItemMetadataById } from "./dataPlanner";
import { NodeItemMetadata, updateNodeItemMetadata } from "./nodeItemMetadata";
import { ViewPath } from "./rowModel";
import {
  Plan,
  planDeepCopyNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
  planUpsertNodes,
} from "./planner";

export type { NodeItemMetadata } from "./nodeItemMetadata";

function planUpdateExistingItemMetadata(
  plan: Plan,
  parentNode: GraphNode,
  nodeID: ID,
  metadata: NodeItemMetadata
): Plan {
  return planUpdateNodeItemMetadataById(plan, parentNode.id, nodeID, metadata);
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
    ? planUpdateExistingItemMetadata(basePlan, parentNode, nodeID, metadata)
    : basePlan;
}
