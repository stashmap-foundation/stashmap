import { CSSProperties } from "react";
import { useCurrentEdge, useIsViewingOtherUserContent } from "./RowContext";
import { isRefNode } from "../../graph/references";
import { TYPE_COLORS } from "../shared/typeColors";

type RowStyle = {
  cardStyle: CSSProperties;
  textStyle: CSSProperties;
  textClassName: string;
  relevance: Relevance;
};

function getRelevanceTextStyle(relevance: Relevance): CSSProperties {
  switch (relevance) {
    case "relevant":
      return {};
    case "maybe_relevant":
      return {};
    case undefined:
      return {};
    case "little_relevant":
      return {};
    case "not_relevant":
      return { textDecoration: "line-through" };
    default:
      return {};
  }
}

function getArgumentTextStyle(argument: Argument | undefined): CSSProperties {
  if (argument === "confirms") {
    return { color: TYPE_COLORS.confirms };
  }
  if (argument === "contra") {
    return { color: TYPE_COLORS.contra };
  }
  return {};
}

function isReferenceVirtualType(virtualType: VirtualType | undefined): boolean {
  return virtualType === "incoming" || virtualType === "version";
}

export function useRowStyle(): RowStyle {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;

  if (virtualType === "suggestion" || isViewingOtherUserContent) {
    return {
      cardStyle: {},
      textStyle: {},
      textClassName: "text-readonly",
      relevance: undefined,
    };
  }

  if (isReferenceVirtualType(virtualType)) {
    return {
      cardStyle: {},
      textStyle: { fontStyle: "italic" },
      textClassName: "text-readonly",
      relevance: undefined,
    };
  }

  const relevance = currentRow?.relevance;
  const argument = currentRow?.argument;
  const normalizedRelevance =
    relevance === ("" as string) ? undefined : relevance;
  const isOutgoingRef = isRefNode(currentRow);

  return {
    cardStyle: {},
    textStyle: {
      ...getRelevanceTextStyle(normalizedRelevance),
      ...getArgumentTextStyle(argument),
      ...(isOutgoingRef ? { fontStyle: "italic" as const } : {}),
    },
    textClassName: "",
    relevance: normalizedRelevance,
  };
}
