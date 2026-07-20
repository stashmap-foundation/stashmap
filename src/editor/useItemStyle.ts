import { CSSProperties } from "react";
import { useIsViewingOtherUserContent, useRow } from "../rowModel";
import { nodeText } from "../core/nodeSpans";
import { ENTITY_SCHEME_RE } from "../core/linkPath";
import { TYPE_COLORS } from "../core/constants";
import { isCalendarEntryId, isPastCalendarRowText } from "../core/ical";

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
  return (
    virtualType === "incoming" ||
    virtualType === "version" ||
    virtualType === "related-source"
  );
}

export function useItemStyle(): ItemStyle {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const row = useRow();
  const currentRow = row.node;
  const { virtualType } = row;
  // Node-type rendering (like violet for entities): a calendar entry with
  // a past date dims — derived from the row's own id and text, so file
  // rows render correctly with no feed fetch. An explicit judgment
  // un-dims: deliberate emphasis beats default de-emphasis.
  const isPastCalendarRow =
    !!currentRow &&
    isCalendarEntryId(row.standsFor?.id ?? currentRow.id) &&
    currentRow.relevance === undefined &&
    isPastCalendarRowText(
      row.standsFor?.liveText ?? nodeText(currentRow),
      Date.now()
    );

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
  const isEntityNode = !!currentRow && ENTITY_SCHEME_RE.test(currentRow.id);

  return {
    cardStyle: {},
    textStyle: {
      ...getRelevanceTextStyle(normalizedRelevance),
      ...getArgumentTextStyle(argument),
      ...(isEntityNode ? { color: "var(--violet)" } : {}),
      ...(isPastCalendarRow ? { opacity: 0.55 } : {}),
    },
    textClassName: "",
    relevance: normalizedRelevance,
  };
}
