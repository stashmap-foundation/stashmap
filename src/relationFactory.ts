import { List } from "immutable";
import { v4 } from "uuid";
import { joinID, shortID } from "./connections";
import { createRootAnchor } from "./rootAnchor";

export function newRelations(
  text: string,
  semanticContext: Context,
  myself: PublicKey,
  root?: ID,
  parent?: LongID,
  systemRole?: RootSystemRole
): Relations {
  const id = joinID(myself, v4());
  return {
    items: List<RelationItem>(),
    id,
    text,
    parent,
    anchor: !parent ? createRootAnchor(semanticContext) : undefined,
    systemRole: !parent ? systemRole : undefined,
    updated: Date.now(),
    author: myself,
    root: root ?? shortID(id),
  };
}
