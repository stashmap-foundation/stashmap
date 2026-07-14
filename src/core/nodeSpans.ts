import { classifyLinkHref } from "./linkPath";

export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((span) => span.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((span) => span.text).join("");

export const isFileLinkHref = (href: string): boolean => {
  const targetClass = classifyLinkHref(href);
  return targetClass === "document" || targetClass === "file";
};

export const isInternalLinkHref = (href: string): boolean => {
  const targetClass = classifyLinkHref(href);
  return (
    targetClass === "entity" ||
    targetClass === "node" ||
    targetClass === "calendar" ||
    targetClass === "document" ||
    targetClass === "file"
  );
};

export const isWebsiteLinkHref = (href: string): boolean => {
  const targetClass = classifyLinkHref(href);
  return targetClass === "website" || targetClass === "feed";
};

export const getAllLinks = (
  node: GraphNode
): { targetID: ID; text: string }[] =>
  node.spans.flatMap((span) => {
    if (span.kind !== "link") return [];
    const targetClass = classifyLinkHref(span.href);
    return targetClass === "entity" ||
      targetClass === "node" ||
      targetClass === "calendar"
      ? [{ targetID: span.href.slice(1), text: span.text }]
      : [];
  });

export const getAllFileLinks = (
  node: GraphNode
): { path: string; text: string }[] =>
  node.spans.flatMap((span) =>
    span.kind === "link" && isFileLinkHref(span.href)
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
