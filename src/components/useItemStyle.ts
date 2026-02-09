import { CSSProperties } from "react";
import {
  useRelationIndex,
  useViewPath,
  useIsInReferencedByView,
  useIsSuggestion,
  useIsViewingOtherUserContent,
  getParentRelation,
} from "../ViewContext";
import { useData } from "../DataContext";
import { TYPE_COLORS } from "../constants";

type ItemStyle = {
  cardStyle: CSSProperties;
  textStyle: CSSProperties;
  relevance: Relevance;
};

const DEFAULT_STYLE: ItemStyle = {
  cardStyle: {},
  textStyle: {},
  relevance: undefined,
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
      return { textDecoration: "line-through", color: "var(--base01)" };
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

/**
 * Hook that returns styling based on item's relevance, argument, and suggestion status.
 *
 * Styling rules:
 * - Suggestions and other users' content: gray text (non-editable content)
 * - Not relevant: line-through + gray text
 * - Contra: red text
 * - Confirms: green text
 * - Relevance indicators (! ? ~) are shown in gutter, not as text styling
 */
export function useItemStyle(): ItemStyle {
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const isInReferencedByView = useIsInReferencedByView();
  const isSuggestion = useIsSuggestion();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();

  if (isInReferencedByView) {
    return DEFAULT_STYLE;
  }

  if (isSuggestion || isViewingOtherUserContent) {
    return {
      cardStyle: {},
      textStyle: { color: "var(--base01)" },
      relevance: undefined,
    };
  }

  // Get current item's relevance and argument
  const relations = getParentRelation(data, viewPath);
  const currentItem = relations?.items.get(relationIndex ?? -1);
  const relevance = currentItem?.relevance;
  const argument = currentItem?.argument;

  const normalizedRelevance =
    relevance === ("" as string) ? undefined : relevance;

  return {
    cardStyle: {},
    textStyle: {
      ...getRelevanceTextStyle(normalizedRelevance),
      ...getArgumentTextStyle(argument),
    },
    relevance: normalizedRelevance,
  };
}
