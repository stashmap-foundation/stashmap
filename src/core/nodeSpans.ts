import { classifyLinkHref, linkHref, resolveLink } from "./linkPath";

export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((span) => span.text).join("");

export const spansText = (spans: InlineSpan[]): string =>
  spans.map((span) => span.text).join("");

export const isFileLinkHref = (href: string): boolean =>
  classifyLinkHref(href) === "file";

const LINK_TARGET_CLASSES = ["node", "file", "thing", "calendar"];

export const isInternalLinkHref = (href: string): boolean =>
  LINK_TARGET_CLASSES.includes(classifyLinkHref(href));

export const isWebsiteLinkHref = (href: string): boolean => {
  const targetClass = classifyLinkHref(href);
  return targetClass === "website" || targetClass === "feed";
};

export const soleThingAddress = (node: GraphNode): string | undefined => {
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" && classifyLinkHref(span.href) === "thing"
    ? span.href
    : undefined;
};

export const embeddedTarget = (
  node: GraphNode | undefined,
  sourceId: SourceId
): NodeRef | undefined => {
  const span = node?.spans.length === 1 ? node.spans[0] : undefined;
  if (
    !node ||
    node.extraAttrs?.embed !== "true" ||
    span?.kind !== "link" ||
    !["node", "file", "calendar"].includes(classifyLinkHref(span.href))
  ) {
    return undefined;
  }
  return resolveLink(span.href, { sourceId, id: node.id });
};

export const getAllLinks = (
  node: GraphNode,
  sourceId: SourceId
): { target: NodeRef; text: string }[] =>
  node.spans.flatMap((span) => {
    if (span.kind !== "link" || !isInternalLinkHref(span.href)) return [];
    const target = resolveLink(span.href, { sourceId, id: node.id });
    return target ? [{ target, text: span.text }] : [];
  });

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

export const linkSpan = (
  target: NodeRef,
  from: NodeRef,
  text: string
): InlineSpan => ({
  kind: "link",
  href: linkHref(target, from),
  text,
});
