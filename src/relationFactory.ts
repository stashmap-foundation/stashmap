import { List } from "immutable";
import { v4 } from "uuid";
import {
  EMPTY_SEMANTIC_ID,
  hashText,
  isSearchId,
  joinID,
  parseSearchId,
  shortID,
} from "./connections";
import { createRootAnchor } from "./rootAnchor";
import { getSystemRoleText } from "./systemRoots";

export function newRelations(
  semanticID: LongID | ID,
  semanticContext: Context,
  myself: PublicKey,
  root?: ID,
  parent?: LongID,
  text?: string,
  systemRole?: RootSystemRole
): Relations {
  const id = joinID(myself, v4());
  const localSemanticID = shortID(semanticID) as ID;
  const relationText = (() => {
    if (text !== undefined) {
      return text;
    }
    if (systemRole) {
      return getSystemRoleText(systemRole);
    }
    if (localSemanticID === EMPTY_SEMANTIC_ID) {
      return "";
    }
    if (isSearchId(localSemanticID)) {
      return parseSearchId(localSemanticID) || "";
    }
    return "";
  })();
  const shouldHashRelationText =
    text !== undefined ||
    systemRole !== undefined ||
    localSemanticID === EMPTY_SEMANTIC_ID;
  const relationTextHash = (() => {
    if (isSearchId(localSemanticID)) {
      return localSemanticID;
    }
    return shouldHashRelationText ? hashText(relationText) : localSemanticID;
  })();
  return {
    items: List<RelationItem>(),
    id,
    text: relationText,
    textHash: relationTextHash,
    parent,
    anchor: !parent ? createRootAnchor(semanticContext) : undefined,
    systemRole: !parent ? systemRole : undefined,
    updated: Date.now(),
    author: myself,
    root: root ?? shortID(id),
  };
}

export function newRelationsForSemanticID(
  semanticID: LongID | ID,
  semanticContext: Context,
  myself: PublicKey,
  root?: ID,
  parent?: LongID,
  text?: string,
  systemRole?: RootSystemRole
): Relations {
  return newRelations(
    semanticID,
    semanticContext,
    myself,
    root,
    parent,
    text,
    systemRole
  );
}
