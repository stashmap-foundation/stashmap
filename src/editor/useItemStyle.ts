import { CSSProperties } from "react";
import { useIsViewingOtherUserContent, useRow } from "../rowModel";
import { isRefNode } from "../core/connections";
import { isBlockFileLink } from "../core/nodeSpans";
import { ENTITY_SCHEME_RE } from "../core/entityRecognition";
import { TYPE_COLORS } from "../core/constants";

type ItemStyle = {
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

function isReferenceVirtualType(virtualType: Row["virtualType"]): boolean {
  return virtualType === "incoming" || virtualType === "version";
}

export function useItemStyle(): ItemStyle {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const row = useRow();
  const currentRow = row.node;
  const { virtualType } = row;

  if (virtualType === "suggestion") {
    return {
      cardStyle: {},
      textStyle: {},
      textClassName: "text-readonly",
      relevance: undefined,
    };
  }

  if (isViewingOtherUserContent) {
    const relevance = currentRow?.relevance;
    const argument = currentRow?.argument;
    const normalizedRelevance =
      relevance === ("" as string) ? undefined : relevance;
    const argumentStyle = getArgumentTextStyle(argument);
    return {
      cardStyle: {},
      textStyle: {
        ...getRelevanceTextStyle(normalizedRelevance),
        ...argumentStyle,
        ...(argumentStyle.color ? { opacity: 0.6 } : {}),
      },
      textClassName: "text-readonly",
      relevance: normalizedRelevance,
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
  const isOutgoingRef = isRefNode(currentRow) || isBlockFileLink(currentRow);
  // Violet means entity — the node itself carries a canonical entity id
  // (an entity home's root). Links to entities get theirs via linkStyle.
  const isEntityNode = !!currentRow && ENTITY_SCHEME_RE.test(currentRow.id);

  return {
    cardStyle: {},
    textStyle: {
      ...getRelevanceTextStyle(normalizedRelevance),
      ...getArgumentTextStyle(argument),
      ...(isOutgoingRef ? { fontStyle: "italic" as const } : {}),
      ...(isEntityNode ? { color: "var(--violet)" } : {}),
    },
    textClassName: "",
    relevance: normalizedRelevance,
  };
}
