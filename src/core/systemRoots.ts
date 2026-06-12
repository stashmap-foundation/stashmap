import { workspaceOf } from "./knowledge";

export const LOG_ROOT_ROLE: RootSystemRole = "log";
export const LOG_ROOT_FILE = "log.md";
const LOG_ROOT_TEXT = "~Log";

export function isStandaloneRoot(node: GraphNode): boolean {
  return !node.parent && node.root === node.id;
}

export function getOwnSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  systemRole: RootSystemRole
): GraphNode | undefined {
  return workspaceOf(knowledgeDBs)
    .nodes.valueSeq()
    .filter((node) => node.systemRole === systemRole && isStandaloneRoot(node))
    .sortBy((node) => -node.updated)
    .first();
}

export function getOwnLogRoot(
  knowledgeDBs: KnowledgeDBs
): GraphNode | undefined {
  return getOwnSystemRoot(knowledgeDBs, LOG_ROOT_ROLE);
}

export function getSystemRoleText(systemRole: RootSystemRole): string {
  switch (systemRole) {
    case LOG_ROOT_ROLE:
    default:
      return LOG_ROOT_TEXT;
  }
}
