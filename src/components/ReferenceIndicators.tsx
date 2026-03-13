import React from "react";
import {
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
  isRefNode,
  splitID,
} from "../connections";
import { useData } from "../DataContext";

/**
 * Shows user icon for concrete refs owned by another user
 */
export function ReferenceIndicators({
  refId,
}: {
  refId: ID;
}): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const sourceItem = getRelationsNoReferencedBy(
    knowledgeDBs,
    refId,
    user.publicKey
  );
  if (!isRefNode(sourceItem)) {
    return null;
  }
  const relation = getConcreteRefTargetRelation(
    knowledgeDBs,
    refId,
    user.publicKey
  );
  if (!relation) {
    return null;
  }

  const [owner] = splitID(relation.id);
  const isOtherUser = owner && owner !== user.publicKey;

  if (!isOtherUser) {
    return null;
  }

  return (
    <span
      className="reference-indicators"
      style={{
        opacity: 0.6,
        fontSize: "inherit",
        fontStyle: "normal",
      }}
    >
      <span
        title="Content from another user"
        aria-hidden="true"
        style={{ marginRight: "4px" }}
      >
        👤
      </span>
    </span>
  );
}
