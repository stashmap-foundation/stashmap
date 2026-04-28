import { decodePublicKeyInputSync } from "./nostrPublicKeys";
import { nodeText } from "./core/nodeSpans";

export function getNodeUserPublicKey(
  node?: GraphNode,
  text = node ? nodeText(node) : undefined
): PublicKey | undefined {
  return (
    decodePublicKeyInputSync(text) ||
    node?.userPublicKey ||
    decodePublicKeyInputSync(node ? nodeText(node) : undefined)
  );
}

export function withUsersEntryPublicKey(
  node: GraphNode,
  text = nodeText(node)
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
