import { docLinkId, isMarkdownPath } from "./linkPath";

export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((span) => span.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((span) => span.text).join("");

type LinkSpan = Extract<InlineSpan, { kind: "link" }>;
export type BlockLinkNode = GraphNode & { spans: [LinkSpan] };
export type BlockFileLinkNode = GraphNode & { spans: [LinkSpan] };

function isBareLink(node: GraphNode | undefined): node is BlockLinkNode {
  return !!node && node.spans.length === 1 && node.spans[0].kind === "link";
}

export const isBlockLink = (
  node: GraphNode | undefined
): node is BlockLinkNode =>
  isBareLink(node) && node.spans[0].href.startsWith("#");

export const isBlockFileLink = (
  node: GraphNode | undefined
): node is BlockFileLinkNode =>
  isBareLink(node) &&
  (docLinkId(node.spans[0].href) !== undefined ||
    isMarkdownPath(node.spans[0].href));

export const isBlockLinkAny = (
  node: GraphNode | undefined
): node is BlockLinkNode | BlockFileLinkNode =>
  isBlockLink(node) || isBlockFileLink(node);

export const getBlockLinkTarget = (
  node: GraphNode | undefined
): ID | undefined => {
  if (!isBlockLink(node)) return undefined;
  return node.spans[0].href.slice(1);
};

export const getBlockLinkText = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockLink(node)) return undefined;
  return node.spans[0].text;
};

export const getBlockFileLinkPath = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockFileLink(node)) return undefined;
  return node.spans[0].href;
};

export const getBlockFileLinkText = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockFileLink(node)) return undefined;
  return node.spans[0].text;
};

export const getAllLinks = (
  node: GraphNode
): { targetID: ID; text: string }[] =>
  node.spans.flatMap((span) =>
    span.kind === "link" && span.href.startsWith("#")
      ? [{ targetID: span.href.slice(1), text: span.text }]
      : []
  );

export const getAllFileLinks = (
  node: GraphNode
): { path: string; text: string }[] =>
  node.spans.flatMap((span) =>
    span.kind === "link" &&
    (docLinkId(span.href) !== undefined || isMarkdownPath(span.href))
      ? [{ path: span.href, text: span.text }]
      : []
  );

function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/gu, "\\$1");
}

export const spansToMarkdown = (spans: InlineSpan[]): string =>
  spans
    .map((span) =>
      span.kind === "text"
        ? span.text
        : `[${escapeLinkText(span.text)}](${span.href})`
    )
    .join("");

export const linkSpan = (targetID: ID, text: string): InlineSpan => ({
  kind: "link",
  href: `#${targetID}`,
  text,
});

export const fileLinkSpan = (path: string, text: string): InlineSpan => ({
  kind: "link",
  href: path,
  text,
});
