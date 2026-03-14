import React from "react";
import { getNode, resolveNode, isRefNode, splitID } from "../connections";
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
  const sourceItem = getNode(knowledgeDBs, refId, user.publicKey);
  if (!isRefNode(sourceItem)) {
    return null;
  }
  const relation = resolveNode(knowledgeDBs, sourceItem);
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
