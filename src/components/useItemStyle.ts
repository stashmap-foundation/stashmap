import { CSSProperties } from "react";
import {
  useIsViewingOtherUserContent,
  useRelationItem,
  useNodeID,
} from "../ViewContext";
import { isConcreteRefId } from "../connections";
import { TYPE_COLORS } from "../constants";

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

function isReferenceVirtualType(virtualType: VirtualType | undefined): boolean {
  return (
    virtualType === "incoming" ||
    virtualType === "occurrence" ||
    virtualType === "version"
  );
}

export function useItemStyle(): ItemStyle {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const currentItem = useRelationItem();
  const [nodeID] = useNodeID();
  const virtualType = currentItem?.virtualType;

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
      textStyle: { color: "var(--base01)", fontStyle: "italic" },
      textClassName: "",
      relevance: undefined,
    };
  }

  const relevance = currentItem?.relevance;
  const argument = currentItem?.argument;
  const normalizedRelevance =
    relevance === ("" as string) ? undefined : relevance;
  const isOutgoingRef = isConcreteRefId(nodeID);

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
