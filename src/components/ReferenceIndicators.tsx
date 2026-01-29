import React from "react";
import {
  getRelationsNoReferencedBy,
  isConcreteRefId,
  parseConcreteRefId,
  splitID,
} from "../connections";
import { useData } from "../DataContext";

/**
 * Shows user icon for concrete refs owned by another user
 */
export function ReferenceIndicators({
  refId,
}: {
  refId: LongID | ID;
}): JSX.Element | null {
  const { knowledgeDBs, user } = useData();

  if (!isConcreteRefId(refId)) {
    return null;
  }

  const parsed = parseConcreteRefId(refId);
  if (!parsed) {
    return null;
  }

  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
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
