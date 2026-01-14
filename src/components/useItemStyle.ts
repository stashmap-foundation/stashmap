import { CSSProperties } from "react";
import {
  useRelationIndex,
  useViewPath,
  getParentView,
  useIsInReferencedByView,
  useIsAddToNode,
  useIsDiffItem,
  getRelationForView,
} from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";
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
      return { opacity: 0.5 };
    case "not_relevant":
      return { opacity: 0.4, textDecoration: "line-through" };
    default:
      return {};
  }
}

function getArgumentTextStyle(argument: Argument): CSSProperties {
  if (argument === "confirms") {
    return {
      backgroundColor: `${TYPE_COLORS.confirms}20`, // 20 = 12% in hex
      borderRadius: "3px",
      padding: "0 4px",
    };
  }
  if (argument === "contra") {
    return {
      backgroundColor: `${TYPE_COLORS.contra}20`,
      borderRadius: "3px",
      padding: "0 4px",
    };
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
  const { stack } = usePaneNavigation();
  const isInReferencedByView = useIsInReferencedByView();
  const isAddToNode = useIsAddToNode();
  const isDiffItem = useIsDiffItem();
  const parentView = getParentView(viewPath);

  // No styling for add-to-node or referenced-by items
  if (isAddToNode || isInReferencedByView) {
    return DEFAULT_STYLE;
  }

  // Diff items: no special card styling, just the badge indicator
  if (isDiffItem) {
    return DEFAULT_STYLE;
  }

  // Get current item's relevance and argument
  const relations = parentView ? getRelationForView(data, parentView, stack) : undefined;
  const currentItem = relations?.items.get(relationIndex ?? -1);
  const relevance = currentItem?.relevance || "";
  const argument = currentItem?.argument;

  return {
    cardStyle: {},
    textStyle: { ...getRelevanceTextStyle(relevance), ...getArgumentTextStyle(argument) },
  };
}
