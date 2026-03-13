import { decodePublicKeyInputSync } from "./nostrPublicKeys";

export function getRelationUserPublicKey(
  relation?: GraphNode
): PublicKey | undefined {
  if (!relation) {
    return undefined;
  }
  return relation.userPublicKey || decodePublicKeyInputSync(relation.text);
}
