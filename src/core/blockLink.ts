import {
  getBlockFileLinkPath,
  getBlockFileLinkText,
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockFileLink,
  isBlockLink,
} from "./nodeSpans";

export type BlockLink =
  | {
      kind: "node";
      source: GraphNode;
      targetID: LongID;
      text: string;
    }
  | {
      kind: "document";
      source: GraphNode;
      path: string;
      text: string;
    };

export function getBlockLink(
  node: GraphNode | undefined
): BlockLink | undefined {
  const targetID = getBlockLinkTarget(node);
  if (node && isBlockLink(node) && targetID) {
    return {
      kind: "node",
      source: node,
      targetID,
      text: getBlockLinkText(node) ?? "",
    };
  }

  const path = getBlockFileLinkPath(node);
  if (node && isBlockFileLink(node) && path) {
    return {
      kind: "document",
      source: node,
      path,
      text: getBlockFileLinkText(node) ?? "",
    };
  }

  return undefined;
}
