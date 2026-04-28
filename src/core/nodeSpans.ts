export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((s) => s.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((s) => s.text).join("");

type LinkSpan = Extract<InlineSpan, { kind: "link" }>;
type FileLinkSpan = Extract<InlineSpan, { kind: "fileLink" }>;
export type BlockLinkNode = GraphNode & { spans: [LinkSpan] };
export type BlockFileLinkNode = GraphNode & { spans: [FileLinkSpan] };

export const isBlockLink = (
  node: GraphNode | undefined
): node is BlockLinkNode =>
  !!node && node.spans.length === 1 && node.spans[0].kind === "link";

export const isBlockFileLink = (
  node: GraphNode | undefined
): node is BlockFileLinkNode =>
  !!node && node.spans.length === 1 && node.spans[0].kind === "fileLink";

export const isBlockLinkAny = (
  node: GraphNode | undefined
): node is BlockLinkNode | BlockFileLinkNode =>
  isBlockLink(node) || isBlockFileLink(node);

export const getBlockLinkTarget = (
  node: GraphNode | undefined
): LongID | undefined => {
  if (!isBlockLink(node)) return undefined;
  const link = node.spans[0];
  return link.kind === "link" ? link.targetID : undefined;
};

export const getBlockLinkText = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockLink(node)) return undefined;
  const link = node.spans[0];
  return link.kind === "link" ? link.text : undefined;
};

export const getBlockFileLinkPath = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockFileLink(node)) return undefined;
  return node.spans[0].path;
};

export const getBlockFileLinkText = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockFileLink(node)) return undefined;
  return node.spans[0].text;
};

export const getAllLinks = (
  node: GraphNode
): { targetID: LongID; text: string }[] =>
  node.spans
    .filter((s): s is LinkSpan => s.kind === "link")
    .map((s) => ({ targetID: s.targetID, text: s.text }));

export const getAllFileLinks = (
  node: GraphNode
): { path: string; text: string }[] =>
  node.spans
    .filter((s): s is FileLinkSpan => s.kind === "fileLink")
    .map((s) => ({ path: s.path, text: s.text }));

export const spansToMarkdown = (spans: InlineSpan[]): string =>
  spans
    .map((s) => {
      if (s.kind === "text") return s.text;
      if (s.kind === "link") return `[${s.text}](#${s.targetID})`;
      return `[${s.text}](${s.path})`;
    })
    .join("");

export const linkSpan = (targetID: LongID, text: string): InlineSpan => ({
  kind: "link",
  targetID,
  text,
});

export const fileLinkSpan = (path: string, text: string): InlineSpan => ({
  kind: "fileLink",
  path,
  text,
});
