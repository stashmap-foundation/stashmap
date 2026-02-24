import React from "react";
import { TYPE_COLORS } from "../constants";
import { useData } from "../DataContext";

type ReferencePart =
  | { type: "text"; value: string }
  | { type: "arrow"; value: ">>>" | "<<<" }
  | { type: "indicator"; relevance: Relevance; argument?: Argument };

type ReferenceDisplayConfig = {
  displayAs?: "bidirectional" | "incoming" | "occurrence";
  contextLabels: string[];
  targetLabel: string;
  incomingRelevance?: Relevance;
  incomingArgument?: Argument;
  deleted?: boolean;
};

function relevanceChar(relevance?: Relevance): string {
  if (relevance === "relevant") return "!";
  if (relevance === "maybe_relevant") return "?";
  if (relevance === "little_relevant") return "~";
  return "";
}

function argumentChar(argument?: Argument): string {
  if (argument === "confirms") return "+";
  if (argument === "contra") return "-";
  return "";
}

function relevanceColor(relevance?: Relevance): string | undefined {
  if (relevance === "relevant") return TYPE_COLORS.relevant;
  if (relevance === "maybe_relevant") return TYPE_COLORS.maybe_relevant;
  if (relevance === "little_relevant") return TYPE_COLORS.little_relevant;
  return undefined;
}

function argumentColor(argument?: Argument): string | undefined {
  if (argument === "confirms") return TYPE_COLORS.confirms;
  if (argument === "contra") return TYPE_COLORS.contra;
  return undefined;
}

function indicatorPart(
  relevance: Relevance,
  argument?: Argument
): ReferencePart[] {
  return relevanceChar(relevance) || argumentChar(argument)
    ? [{ type: "indicator", relevance, argument }]
    : [];
}

function buildReferenceParts(
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

  if (displayAs === "occurrence") {
    const separator: ReferencePart = { type: "text", value: "/" };
    return [
      ...(contextPath
        ? [{ type: "text" as const, value: contextPath }, separator]
        : []),
      ...indicator,
      target,
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

function RenderPart({ part }: { part: ReferencePart }): JSX.Element {
  if (part.type === "arrow") {
    return <span className="ref-separator">{part.value}</span>;
  }
  if (part.type === "indicator") {
    const relChar = relevanceChar(part.relevance);
    const argChar = argumentChar(part.argument);
    return (
      <>
        {relChar && (
          <span style={{ color: relevanceColor(part.relevance) }}>
            {relChar}
          </span>
        )}
        {argChar && (
          <span style={{ color: argumentColor(part.argument) }}>{argChar}</span>
        )}
      </>
    );
  }
  return <>{part.value}</>;
}

function partKey(part: ReferencePart, index: number): string {
  if (part.type === "indicator") {
    return `${index}-ind-${relevanceChar(part.relevance)}${argumentChar(
      part.argument
    )}`;
  }
  return `${index}-${part.type}-${part.value}`;
}

export function ReferenceDisplay({
  node,
}: {
  node: ReferenceNode;
}): JSX.Element {
  const { user } = useData();
  const parts = buildReferenceParts({
    displayAs: node.displayAs,
    contextLabels: node.contextLabels,
    targetLabel: node.targetLabel,
    incomingRelevance: node.incomingRelevance,
    incomingArgument: node.incomingArgument,
    deleted: node.deleted,
  });
  const isOtherUser = node.author !== user.publicKey;
  const className = node.deleted
    ? "break-word deleted-reference"
    : "break-word";

  return (
    <span className={className} data-testid="reference-node">
      {parts.map((part, i) => (
        <React.Fragment key={partKey(part, i)}>
          {i > 0 && " "}
          <RenderPart part={part} />
        </React.Fragment>
      ))}
      {isOtherUser && (
        <span style={{ fontStyle: "normal" }}>{" \u{1F464}"}</span>
      )}
    </span>
  );
}
