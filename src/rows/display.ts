import { isSearchId, parseSearchId } from "../connections";
import { getNodeUserPublicKey } from "../userEntry";
import { type RowPath } from "./rowPaths";
import {
  getCurrentReferenceForView,
  getNodeForView,
  getRowIDFromView,
} from "./resolveRow";

export function getDisplayTextForView(
  data: Data,
  rowPath: RowPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): string {
  const reference = getCurrentReferenceForView(
    data,
    rowPath,
    stack,
    virtualType,
    currentRow
  );
  if (reference) {
    return reference.text;
  }
  const [rowID] = getRowIDFromView(data, rowPath);
  if (isSearchId(rowID as ID)) {
    const query = parseSearchId(rowID as ID) || "";
    return `Search: ${query}`;
  }
  const ownNode = getNodeForView(data, rowPath, stack);
  const userPublicKey = getNodeUserPublicKey(ownNode);
  const contactPetname = userPublicKey
    ? data.contacts.get(userPublicKey)?.userName
    : undefined;
  if (contactPetname) {
    return contactPetname;
  }
  return ownNode?.text ?? "";
}

type ReferenceTextPart =
  | { type: "text"; value: string }
  | { type: "arrow"; value: ">>>" | "<<<" }
  | { type: "indicator"; relevance: Relevance; argument?: Argument };

type ReferenceTextConfig = {
  displayAs?: "bidirectional" | "incoming";
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

function indicatorPart(
  relevance: Relevance,
  argument?: Argument
): ReferenceTextPart[] {
  return relevanceChar(relevance) || argumentChar(argument)
    ? [{ type: "indicator", relevance, argument }]
    : [];
}

function buildReferenceTextParts(
  config: ReferenceTextConfig
): readonly ReferenceTextPart[] {
  const {
    displayAs,
    contextLabels,
    targetLabel,
    incomingRelevance,
    incomingArgument,
    deleted,
  } = config;

  const contextPath = contextLabels.join(" / ");
  const target: ReferenceTextPart = { type: "text", value: targetLabel };
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

function partToText(part: ReferenceTextPart): string {
  if (part.type === "indicator") {
    return relevanceChar(part.relevance) + argumentChar(part.argument);
  }
  return part.value;
}

export function referenceToText(config: ReferenceTextConfig): string {
  return buildReferenceTextParts(config).map(partToText).join(" ");
}
