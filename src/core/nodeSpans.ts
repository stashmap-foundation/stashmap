import { classifyLinkHref } from "./linkPath";

export const plainSpans = (text: string): InlineSpan[] => [
  { kind: "text", text },
];

export const nodeText = (node: GraphNode): string =>
  node.spans.map((span) => span.text).join("");

export const effectiveText = (node: GraphNode): string =>
  node.spans
    .filter((span) => !(span.kind === "link" && span.struck === true))
    .map((span) => span.text)
    .join("")
    .trim();

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

export const embeddedTarget = (node: GraphNode | undefined): ID | undefined => {
  if (
    node?.extraAttrs?.embed !== "true" ||
    node.spans.length !== 1 ||
    node.spans[0]?.kind !== "link" ||
    node.spans[0].struck === true ||
    !node.spans[0].href.startsWith("#")
  ) {
    return undefined;
  }
  return node.spans[0].href.slice(1);
};

export const rewordingTarget = (
  node: GraphNode | undefined
): ID | undefined => {
  if (node?.extraAttrs?.embed !== "true") {
    return undefined;
  }
  const struck = node.spans.flatMap((span) =>
    span.kind === "link" && span.struck === true && span.href.startsWith("#")
      ? [span.href.slice(1)]
      : []
  );
  return struck.length === 1 ? struck[0] : undefined;
};

export const placementTarget = (node: GraphNode | undefined): ID | undefined =>
  embeddedTarget(node) ?? rewordingTarget(node);

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
    .map((span) => {
      if (span.kind === "text") {
        return span.text;
      }
      const link = `[${escapeLinkText(span.text)}](${span.href})`;
      return span.struck === true ? `~~${link}~~` : link;
    })
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
