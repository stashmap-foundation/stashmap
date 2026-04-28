export type ReferencePart =
  | { type: "text"; value: string }
  | { type: "arrow"; value: ">>>" | "<<<" }
  | { type: "indicator"; relevance: Relevance; argument?: Argument };

export type ReferenceDisplayConfig = {
  displayAs?: "bidirectional" | "incoming";
  contextLabels: string[];
  targetLabel: string;
  incomingRelevance?: Relevance;
  incomingArgument?: Argument;
  deleted?: boolean;
};

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

function indicatorPart(
  relevance: Relevance,
  argument?: Argument
): ReferencePart[] {
  return relevanceChar(relevance) || argumentChar(argument)
    ? [{ type: "indicator", relevance, argument }]
    : [];
}

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
  const indicator = indicatorPart(incomingRelevance!, incomingArgument);

  if (deleted) {
    return [
      { type: "text", value: "(deleted)" },
      ...(contextPath
        ? [
            { type: "text" as const, value: contextPath },
            { type: "text" as const, value: "/" },
          ]
        : []),
      target,
    ];
  }

  if (displayAs === "incoming") {
    const reversedContext = [...contextLabels].reverse().join(" / ");
    return [
      target,
      ...indicator,
      ...(reversedContext
        ? [
            { type: "arrow" as const, value: "<<<" as const },
            { type: "text" as const, value: reversedContext },
          ]
        : []),
    ];
  }

  if (displayAs === "bidirectional") {
    return [
      ...(contextPath
        ? [
            { type: "text" as const, value: contextPath },
            { type: "arrow" as const, value: "<<<" as const },
            { type: "arrow" as const, value: ">>>" as const },
            ...indicator,
          ]
        : []),
      target,
    ];
  }

  return [
    ...(contextPath
      ? [
          { type: "text" as const, value: contextPath },
          { type: "text" as const, value: "/" },
        ]
      : []),
    target,
  ];
}

function partToText(part: ReferencePart): string {
  if (part.type === "indicator") {
    return relevanceChar(part.relevance) + argumentChar(part.argument);
  }
  return part.value;
}

export function referenceToText(config: ReferenceDisplayConfig): string {
  return buildReferenceParts(config).map(partToText).join(" ");
}
