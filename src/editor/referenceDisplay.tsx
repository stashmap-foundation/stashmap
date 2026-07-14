import React from "react";
import { LOCAL } from "../core/nodeRef";
import { TYPE_COLORS } from "../core/constants";
import {
  INCOMING_ARROW,
  ReferencePart,
  argumentChar,
  buildReferenceParts,
  needsReferencePartSpace,
  relevanceChar,
} from "./referenceText";

export { referenceToText } from "./referenceText";

export function relevanceColor(relevance?: Relevance): string | undefined {
  if (relevance === "relevant") return TYPE_COLORS.relevant;
  if (relevance === "maybe_relevant") return TYPE_COLORS.maybe_relevant;
  if (relevance === "little_relevant") return TYPE_COLORS.little_relevant;
  return undefined;
}

export function argumentColor(argument?: Argument): string | undefined {
  if (argument === "confirms") return TYPE_COLORS.confirms;
  if (argument === "contra") return TYPE_COLORS.contra;
  return undefined;
}

export function IncomingPart({
  relevance,
  argument,
  ariaHidden,
}: {
  relevance?: Relevance;
  argument?: Argument;
  ariaHidden?: boolean;
}): JSX.Element {
  const relChar = relevanceChar(relevance);
  const argChar = argumentChar(argument);
  return (
    <sup
      className="incoming-part"
      title="Points back here"
      aria-hidden={ariaHidden}
    >
      {relChar && (
        <span style={{ color: relevanceColor(relevance) }}>{relChar}</span>
      )}
      {argChar && (
        <span style={{ color: argumentColor(argument) }}>{argChar}</span>
      )}
      {INCOMING_ARROW}
    </sup>
  );
}

function RenderPart({ part }: { part: ReferencePart }): JSX.Element {
  if (part.type === "incoming") {
    return <IncomingPart relevance={part.relevance} argument={part.argument} />;
  }
  return <>{part.value}</>;
}

function partKey(part: ReferencePart, index: number): string {
  if (part.type === "incoming") {
    return `${index}-in-${relevanceChar(part.relevance)}${argumentChar(
      part.argument
    )}`;
  }
  return `${index}-${part.type}-${part.value}`;
}

export function ReferenceDisplay({
  reference,
}: {
  reference: {
    displayAs?: "bidirectional" | "incoming";
    contextLabels: string[];
    targetLabel: string;
    incomingRelevance?: Relevance;
    incomingArgument?: Argument;
    deleted?: boolean;
    sourceId: SourceId;
  };
}): JSX.Element {
  const parts = buildReferenceParts({
    displayAs: reference.displayAs,
    contextLabels: reference.contextLabels,
    targetLabel: reference.targetLabel,
    incomingRelevance: reference.incomingRelevance,
    incomingArgument: reference.incomingArgument,
    deleted: reference.deleted,
  });
  const isOtherUser = reference.sourceId !== LOCAL;
  const className = reference.deleted
    ? "break-word deleted-reference"
    : "break-word";

  return (
    <span className={className} data-testid="reference-row">
      {parts.map((part, i) => (
        <React.Fragment key={partKey(part, i)}>
          {needsReferencePartSpace(parts, i) && " "}
          <RenderPart part={part} />
        </React.Fragment>
      ))}
      {isOtherUser && (
        <span style={{ fontStyle: "normal" }}>{" \u{1F464}"}</span>
      )}
    </span>
  );
}
