import {
  getBlockFileLinkPath,
  getBlockFileLinkText,
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockFileLink,
  isBlockLink,
} from "./nodeSpans";
import { Link } from "./link";

export function getBlockLink(
  node: GraphNode | undefined,
  sourceId: SourceId
): Link | undefined {
  const targetID = getBlockLinkTarget(node);
  if (node && isBlockLink(node) && targetID) {
    return {
      kind: "node",
      source: node,
      sourceId,
      targetID,
      text: getBlockLinkText(node) ?? "",
    };
  }

  const path = getBlockFileLinkPath(node);
  if (node && isBlockFileLink(node) && path) {
    return {
      kind: "document",
      source: node,
      sourceId,
      path,
      text: getBlockFileLinkText(node) ?? "",
    };
  }

  return undefined;
}
