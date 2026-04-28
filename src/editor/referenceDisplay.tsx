import React from "react";
import { TYPE_COLORS } from "../core/constants";
import { useData } from "../DataContext";
import {
  ReferencePart,
  argumentChar,
  buildReferenceParts,
  relevanceChar,
} from "./referenceText";

export { referenceToText } from "./referenceText";

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
  reference,
}: {
  reference: ReferenceRow;
}): JSX.Element {
  const { user } = useData();
  const parts = buildReferenceParts({
    displayAs: reference.displayAs,
    contextLabels: reference.contextLabels,
    targetLabel: reference.targetLabel,
    incomingRelevance: reference.incomingRelevance,
    incomingArgument: reference.incomingArgument,
    deleted: reference.deleted,
  });
  const isOtherUser = reference.author !== user.publicKey;
  const className = reference.deleted
    ? "break-word deleted-reference"
    : "break-word";

  return (
    <span className={className} data-testid="reference-row">
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
