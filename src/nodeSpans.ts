export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((s) => s.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((s) => s.text).join("");

type LinkSpan = Extract<InlineSpan, { kind: "link" }>;
export type BlockLinkNode = GraphNode & { spans: [LinkSpan] };

export const isBlockLink = (
  node: GraphNode | undefined
): node is BlockLinkNode =>
  !!node && node.spans.length === 1 && node.spans[0].kind === "link";

export const getBlockLinkTarget = (
  node: GraphNode | undefined
): LongID | undefined => {
  if (!isBlockLink(node)) return undefined;
  const link = (node as GraphNode).spans[0];
  return link.kind === "link" ? link.targetID : undefined;
};

export const getBlockLinkText = (
  node: GraphNode | undefined
): string | undefined => {
  if (!isBlockLink(node)) return undefined;
  const link = (node as GraphNode).spans[0];
  return link.kind === "link" ? link.text : undefined;
};

export const getAllLinks = (
  node: GraphNode
): { targetID: LongID; text: string }[] =>
  node.spans
    .filter(
      (s): s is Extract<InlineSpan, { kind: "link" }> => s.kind === "link"
    )
    .map((s) => ({ targetID: s.targetID, text: s.text }));

export const spansToMarkdown = (spans: InlineSpan[]): string =>
  spans
    .map((s) => (s.kind === "text" ? s.text : `[${s.text}](#${s.targetID})`))
    .join("");

export const linkSpan = (targetID: LongID, text: string): InlineSpan => ({
  kind: "link",
  targetID,
  text,
});
