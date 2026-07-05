export type ReferencePart =
  | { type: "text"; value: string }
  | { type: "incoming"; relevance?: Relevance; argument?: Argument };

export type ReferenceDisplayConfig = {
  displayAs?: "bidirectional" | "incoming";
  contextLabels: string[];
  targetLabel: string;
  incomingRelevance?: Relevance;
  incomingArgument?: Argument;
  deleted?: boolean;
};

export const INCOMING_ARROW = "↩"; // ↩

export function relevanceChar(relevance?: Relevance): string {
  if (relevance === "relevant") return "!";
  if (relevance === "maybe_relevant") return "?";
  if (relevance === "little_relevant") return "~";
  return "";
}

export function argumentChar(argument?: Argument): string {
  if (argument === "confirms") return "+";
  if (argument === "contra") return "-";
  return "";
}

// The incoming part: the other side's judgment chars plus the return arrow,
// rendered as one superscript cluster. Link + incoming part = bidirectional;
// the same part on a footer row is a suggested bidirectional link. Outgoing
// links are unmarked — a link is the default relationship.
export function buildReferenceParts(
  config: ReferenceDisplayConfig
): readonly ReferencePart[] {
  const {
    displayAs,
    contextLabels,
    targetLabel,
    incomingRelevance,
    incomingArgument,
    deleted,
  } = config;

  const contextPath = contextLabels.join(" / ");
  const target: ReferencePart = { type: "text", value: targetLabel };

  const endpoint = [
    ...(deleted ? [{ type: "text" as const, value: "(deleted)" }] : []),
    ...(contextPath
      ? [
          { type: "text" as const, value: contextPath },
          { type: "text" as const, value: "/" },
        ]
      : []),
    target,
  ];

  if (deleted || !displayAs) {
    return endpoint;
  }

  return [
    ...endpoint,
    {
      type: "incoming",
      relevance: incomingRelevance,
      argument: incomingArgument,
    },
  ];
}

function partToText(part: ReferencePart): string {
  if (part.type === "incoming") {
    return (
      relevanceChar(part.relevance) +
      argumentChar(part.argument) +
      INCOMING_ARROW
    );
  }
  return part.value;
}

export function needsReferencePartSpace(
  _parts: readonly ReferencePart[],
  index: number
): boolean {
  return index > 0;
}

export function referenceToText(config: ReferenceDisplayConfig): string {
  const parts = buildReferenceParts(config);
  return parts.reduce(
    (text, part, index) =>
      `${text}${needsReferencePartSpace(parts, index) ? " " : ""}${partToText(
        part
      )}`,
    ""
  );
}
