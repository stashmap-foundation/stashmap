import React from "react";
import {
  useCurrentEdge,
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentRowID,
  useCurrentRelation,
  useDisplayText,
} from "../ViewContext";
import { isEmptySemanticID } from "../connections";
import { useData } from "../DataContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { usePlanner, planUpsertContact, planRemoveContact } from "../planner";
import { preventEditorBlur } from "./AddNode";
import { getRelationUserPublicKey } from "../userEntries";
import { decodePublicKeyInputSync } from "../nostrPublicKeys";

function useCurrentUserEntryPublicKey(): PublicKey | undefined {
  return getRelationUserPublicKey(useCurrentRelation());
}

function FollowUserEntryButton(): JSX.Element | null {
  const data = useData();
  const displayText = useDisplayText();
  const { createPlan, executePlan } = usePlanner();
  const userPublicKey = useCurrentUserEntryPublicKey();
  if (!userPublicKey) {
    return null;
  }

  const isFollowing = data.contacts.has(userPublicKey);
  const actionLabel = isFollowing ? "Unfollow" : "Follow";
  const ariaLabel = `${actionLabel.toLowerCase()} ${
    displayText || userPublicKey
  }`;

  const onClick = (): void => {
    const basePlan = createPlan();
    const userName = !decodePublicKeyInputSync(displayText)
      ? displayText
      : undefined;
    executePlan(
      isFollowing
        ? planRemoveContact(basePlan, userPublicKey)
        : planUpsertContact(basePlan, {
            publicKey: userPublicKey,
            userName,
          })
    );
  };

  return (
    <button
      type="button"
      className="pill"
      aria-label={ariaLabel}
      onMouseDown={preventEditorBlur}
      onClick={onClick}
      title={actionLabel}
    >
      {actionLabel}
    </button>
  );
}

export function RightMenu(): JSX.Element {
  const virtualType = useCurrentEdge()?.virtualType;
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "version";
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const userEntryPublicKey = useCurrentUserEntryPublicKey();
  const [itemID] = useCurrentRowID();

  const isReadonly =
    isRoot || isInSearchView || (isViewingOtherUserContent && !isVirtualItem);

  return (
    <div className="right-menu">
      <div className="relevance-slot">
        {!isReadonly && !userEntryPublicKey && (
          <RelevanceSelector virtualType={virtualType} />
        )}
      </div>
      <div className="evidence-slot">
        {!isReadonly && !userEntryPublicKey && virtualType !== "suggestion" && (
          <EvidenceSelector />
        )}
      </div>
      {!isEmptySemanticID(itemID) && (
        <div className="action-slot">
          <FollowUserEntryButton />
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
