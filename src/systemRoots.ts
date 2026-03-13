export const LOG_ROOT_ROLE: RootSystemRole = "log";
export const LOG_ROOT_TEXT = "~Log";

export function isStandaloneRoot(relation: GraphNode): boolean {
  return !relation.parent && relation.root === relation.id;
}

export function getOwnSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  systemRole: RootSystemRole
): GraphNode | undefined {
  return knowledgeDBs
    .get(author)
    ?.nodes.valueSeq()
    .filter(
      (relation) =>
        relation.author === author &&
        relation.systemRole === systemRole &&
        isStandaloneRoot(relation)
    )
    .sortBy((relation) => -relation.updated)
    .first();
}

export function getOwnLogRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey
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
