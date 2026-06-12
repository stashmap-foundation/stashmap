export const LOG_ROOT_ROLE: RootSystemRole = "log";
export const LOG_ROOT_FILE = "log.md";
const LOG_ROOT_TEXT = "~Log";

export function isStandaloneRoot(node: GraphNode): boolean {
  return !node.parent && node.root === node.id;
}

export function getOwnSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  author: SourceId,
  systemRole: RootSystemRole
): GraphNode | undefined {
  return knowledgeDBs
    .get(author)
    ?.nodes.valueSeq()
    .filter((node) => node.systemRole === systemRole && isStandaloneRoot(node))
    .sortBy((node) => -node.updated)
    .first();
}

export function getOwnLogRoot(
  knowledgeDBs: KnowledgeDBs,
  author: SourceId
): GraphNode | undefined {
  return getOwnSystemRoot(knowledgeDBs, author, LOG_ROOT_ROLE);
}

export function getSystemRoleText(systemRole: RootSystemRole): string {
  switch (systemRole) {
    case LOG_ROOT_ROLE:
    default:
      return LOG_ROOT_TEXT;
  }
}
