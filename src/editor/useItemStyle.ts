import { CSSProperties } from "react";
import {
  getDisplayTextForRow,
  rowArgument,
  rowID,
  rowRelevance,
  useIsViewingOtherUserContent,
  useRow,
} from "../rowModel";
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
  return virtualType === "incoming";
}

export function useItemStyle(): ItemStyle {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const row = useRow();
  const { virtualType } = row;
  const occurrence = row.rowType === "occurrence" ? row.occurrence : undefined;
  const relevance = rowRelevance(row);
  const argument = rowArgument(row);
  const id = rowID(row);
  const isPastCalendarRow =
    isCalendarEntryId(occurrence?.target ?? id) &&
    relevance === undefined &&
    isPastCalendarRowText(getDisplayTextForRow(row), Date.now());

  if (isViewingOtherUserContent) {
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

  const normalizedRelevance =
    relevance === ("" as string) ? undefined : relevance;
  const isEntityNode = ENTITY_SCHEME_RE.test(id);

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
