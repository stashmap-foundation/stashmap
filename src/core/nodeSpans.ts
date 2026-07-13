import { docLinkId, isMarkdownPath } from "./linkPath";

export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((span) => span.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((span) => span.text).join("");

export const isFileLinkHref = (href: string): boolean =>
  docLinkId(href) !== undefined || isMarkdownPath(href);

export const isInternalLinkHref = (href: string): boolean =>
  href.startsWith("#") || isFileLinkHref(href);

export const isWebsiteLinkHref = (href: string): boolean =>
  /^https?:\/\//u.test(href) || /^feed:https?:\/\//u.test(href);

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
