import crypto from "crypto";
import { shortID } from "./connections";

export const LOG_ROOT_ROLE: RootSystemRole = "log";
export const LOG_ROOT_TEXT = "~Log";
export const LOG_ROOT_SEMANTIC_ID = crypto
  .createHash("sha256")
  .update(LOG_ROOT_TEXT)
  .digest("hex")
  .slice(0, 32) as ID;

export function isStandaloneRoot(relation: Relations): boolean {
  return relation.root === shortID(relation.id);
}

export function getOwnSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  systemRole: RootSystemRole
): Relations | undefined {
  return knowledgeDBs
    .get(author)
    ?.relations.valueSeq()
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
): Relations | undefined {
  return getOwnSystemRoot(knowledgeDBs, author, LOG_ROOT_ROLE);
}

export function getSystemRoleText(systemRole: RootSystemRole): string {
  switch (systemRole) {
    case LOG_ROOT_ROLE:
      return LOG_ROOT_TEXT;
    default:
      return LOG_ROOT_TEXT;
  }
}
