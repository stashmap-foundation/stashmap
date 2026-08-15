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
    node.spans[0].struck === true
  ) {
    return undefined;
  }
  const { href } = node.spans[0];
  if (href.startsWith("#")) {
    return href.slice(1);
  }
  return classifyLinkHref(href) === "feed" ? href : undefined;
};

export const rewordingTargets = (node: GraphNode | undefined): ID[] =>
  node?.extraAttrs?.embed === "true"
    ? node.spans.flatMap((span) =>
        span.kind === "link" &&
        span.struck === true &&
        span.href.startsWith("#")
          ? [span.href.slice(1)]
          : []
      )
    : [];

export const placementTarget = (node: GraphNode | undefined): ID | undefined =>
  embeddedTarget(node) ?? rewordingTargets(node)[0];

export const nodeTargets = (node: GraphNode): ID[] => {
  const rewording = rewordingTargets(node);
  if (rewording.length > 0) {
    return rewording;
  }
  if (node.extraAttrs?.rewordedFrom !== undefined) {
    const span = node.spans.find(
      (candidate) =>
        candidate.kind === "link" &&
        candidate.struck !== true &&
        candidate.href.startsWith("#")
    );
    return span?.kind === "link" ? [span.href.slice(1)] : [];
  }
  const embedded = embeddedTarget(node);
  if (embedded !== undefined) {
    return [embedded];
  }
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" &&
    span.struck !== true &&
    span.href.startsWith("#")
    ? [span.href.slice(1)]
    : [];
};

export const nodeTarget = (node: GraphNode): ID | undefined =>
  nodeTargets(node)[0];

export const nodeRowKind = (
  node: GraphNode
): "placement" | "speaking" | "link" | "own" => {
  if (rewordingTargets(node).length > 0) {
    return "speaking";
  }
  if (embeddedTarget(node) !== undefined) {
    return "placement";
  }
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" &&
    span.struck !== true &&
    span.href.startsWith("#")
    ? "link"
    : "own";
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
