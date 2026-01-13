import React from "react";
import { getRefTargetRelationInfo, isRemote, splitID } from "../connections";
import { getAvailableRelationsForNode } from "../ViewContext";
import { useData } from "../DataContext";

/**
 * Shows inline indicators for a Reference node's target:
 * - Item count: how many children the target has in this context
 * - Dots: how many other users have versions of this target's list
 */
export function ReferenceIndicators({
  refId,
}: {
  refId: LongID | ID;
}): JSX.Element | null {
  const { knowledgeDBs, user } = useData();

  const targetInfo = getRefTargetRelationInfo(refId);
  if (!targetInfo) {
    return null;
  }

  const { head, context } = targetInfo;
  const relations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    head,
    context
  );

  // Get the primary relation (mine first, then others)
  const myRelation = relations.find(
    (r) => !isRemote(splitID(r.id)[0], user.publicKey)
  );
  const primaryRelation = myRelation || relations.first();

  // Count other versions (from other users)
  const otherVersionsCount = relations.filter((r) =>
    isRemote(splitID(r.id)[0], user.publicKey)
  ).size;

  // Item count from primary relation
  const itemCount = primaryRelation?.items.size || 0;

  // Don't show anything if no useful info
  if (otherVersionsCount === 0 && itemCount === 0) {
    return null;
  }

  const getOtherUsersIcon = (count: number): string => {
    if (count === 1) return "iconsminds-business-man";
    if (count === 2) return "iconsminds-business-man-woman";
    return "iconsminds-business-mens";
  };

  return (
    <span
      className="reference-indicators"
      style={{
        opacity: 0.6,
        fontSize: "inherit",
        fontStyle: "normal",
      }}
    >
      {itemCount > 0 && (
        <span title={`${itemCount} item${itemCount > 1 ? "s" : ""}`}>
          [{itemCount}]
        </span>
      )}
      {otherVersionsCount > 0 && (
        <span
          className={getOtherUsersIcon(otherVersionsCount)}
          title={`${otherVersionsCount} other version${
            otherVersionsCount > 1 ? "s" : ""
          }`}
          style={{ marginLeft: "4px" }}
        />
      )}{" "}
    </span>
  );
}
