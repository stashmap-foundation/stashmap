import { Map } from "immutable";
import { LOCAL } from "./nodeRef";

export function newDB(): KnowledgeData {
  return {
    nodes: Map<ID, GraphNode>(),
  };
}

export function workspaceOf(knowledgeDBs: KnowledgeDBs): KnowledgeData {
  return knowledgeDBs.get(LOCAL, newDB());
}

export function withWorkspace(
  knowledgeDBs: KnowledgeDBs,
  workspace: KnowledgeData
): KnowledgeDBs {
  return knowledgeDBs.set(LOCAL, workspace);
}

export function getWorkspaceNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID | undefined
): GraphNode | undefined {
  if (!nodeID) {
    return undefined;
  }
  return workspaceOf(knowledgeDBs).nodes.get(nodeID);
}
