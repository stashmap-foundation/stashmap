import { decodePublicKeyInputSync } from "./nostrPublicKeys";

export function getNodeUserPublicKey(
  node?: GraphNode,
  text = node?.text
): PublicKey | undefined {
  return (
    decodePublicKeyInputSync(text) ||
    node?.userPublicKey ||
    decodePublicKeyInputSync(node?.text)
  );
}

export function withUsersEntryPublicKey(
  node: GraphNode,
  text = node.text
): GraphNode {
  const userPublicKey = getNodeUserPublicKey(node, text);
  if (!userPublicKey) {
    return node;
  }

  return {
    ...node,
    userPublicKey,
  };
}
