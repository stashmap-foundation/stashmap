import { decodePublicKeyInputSync } from "./nostrPublicKeys";

export function getUsersEntryPublicKey(
  text: string,
  relation?: GraphNode
): PublicKey | undefined {
  return (
    decodePublicKeyInputSync(text) ||
    relation?.userPublicKey ||
    decodePublicKeyInputSync(relation?.text)
  );
}

export function withUsersEntryPublicKey(
  relation: GraphNode,
  text = relation.text
): GraphNode {
  const userPublicKey = getUsersEntryPublicKey(text, relation);
  if (!userPublicKey) {
    return relation;
  }

  return {
    ...relation,
    userPublicKey,
  };
}
