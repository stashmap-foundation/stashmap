import { CSSProperties } from "react";
import {
  useRelationIndex,
  useViewPath,
  getParentView,
  useIsInReferencedByView,
  useIsDiffItem,
  getRelationForView,
} from "../ViewContext";
import { usePaneStack } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { TYPE_COLORS } from "../constants";

type ItemStyle = {
  cardStyle: CSSProperties;
  textStyle: CSSProperties;
};

const DEFAULT_STYLE: ItemStyle = {
  cardStyle: {},
  textStyle: {},
};

function getRelevanceTextStyle(relevance: Relevance): CSSProperties {
  switch (relevance) {
    case "relevant":
      return { fontWeight: 600 };
    case "": // Maybe relevant (default) - normal text
      return {};
    case "little_relevant":
      return { color: "var(--base01)" };
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
 * Hook that returns styling based on item's relevance, argument, and diff status.
 *
 * Styling rules:
 * - Relevant: bold text
 * - Maybe relevant: normal text
 * - Little relevant: 60% opacity
 * - Contra: light red background
 * - Confirms: light green background
 * - Diff items: 70% opacity + dashed left border
 */
export function useItemStyle(): ItemStyle {
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const stack = usePaneStack();
  const isInReferencedByView = useIsInReferencedByView();
  const isDiffItem = useIsDiffItem();
  const parentView = getParentView(viewPath);

  if (isInReferencedByView) {
    return DEFAULT_STYLE;
  }

  // Diff items: no special card styling, just the badge indicator
  if (isDiffItem) {
    return DEFAULT_STYLE;
  }

  // Get current item's relevance and argument
  const relations = parentView
    ? getRelationForView(data, parentView, stack)
    : undefined;
  const currentItem = relations?.items.get(relationIndex ?? -1);
  const relevance = currentItem?.relevance || "";
  const argument = currentItem?.argument;

  return {
    cardStyle: {},
    textStyle: {
      ...getRelevanceTextStyle(relevance),
      ...getArgumentTextStyle(argument),
    },
  };
}
