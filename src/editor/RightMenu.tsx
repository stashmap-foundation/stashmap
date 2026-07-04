import React from "react";
import {
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentRowID,
  useCurrentNode,
  useRow,
} from "../rowModel";
import { isEmptySemanticID } from "../core/connections";
import { useCurrentPane } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { usePlanner } from "../planner";
import { LOCAL } from "../core/nodeRef";
import { getDocumentByIdOrFilePath } from "../core/Document";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { getNodeDocumentId, planSetDocumentPublishState } from "../core/plan";
import { unpublishedLinkTarget } from "./publishReach";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

// A link row inside a published document whose target isn't shared: a
// truthful description (readers see this title but can't open it) and a
// one-tap grant of this document's effective set and relays. No dialogs.
function PublishReachChip(): JSX.Element | null {
  const data = useData();
  const pane = useCurrentPane();
  const node = useCurrentNode();
  const { createPlan, executePlan } = usePlanner();

  if (pane.sourceId !== LOCAL) {
    return null;
  }
  const docId =
    pane.documentId ??
    (node
      ? getNodeDocumentId({ knowledgeDBs: data.knowledgeDBs }, node)
      : undefined);
  const paneDocument = docId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        LOCAL,
        docId
      )
    : undefined;
  const target = unpublishedLinkTarget(
    data.knowledgeDBs,
    data.documents,
    data.documentByFilePath,
    paneDocument,
    node
  );
  if (!paneDocument || !target) {
    return null;
  }

  const grant = (): void => {
    const state = publishStateOf(paneDocument.frontMatter);
    executePlan(
      planSetDocumentPublishState(createPlan(), target.docId, {
        entities: [
          ...new Set([
            ...paneDocument.topNodeShortIds,
            ...(state?.entities ?? []),
          ]),
        ],
        relays: state?.relays,
        paused: false,
      })
    );
  };

  return (
    <button
      type="button"
      className="publish-reach-chip"
      onClick={grant}
      aria-label={`publish linked document ${target.title || target.docId}`}
      title="Readers of this document can see this link but can't open it — click to publish the target to the same audience"
    >
      not shared
    </button>
  );
}

export function RightMenu(): JSX.Element {
  const { virtualType } = useRow();
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "version";
  const isRoot = useIsRoot();
  const pane = useCurrentPane();
  const currentNode = useCurrentNode();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const [rowID] = useCurrentRowID();
  const isDocumentTopLevel =
    isRoot && pane.documentId !== undefined && !isVirtualItem && !!currentNode;

  const isReadonly =
    (isRoot && !isDocumentTopLevel) ||
    isInSearchView ||
    (isViewingOtherUserContent && !isVirtualItem);

  return (
    <div className="right-menu">
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector virtualType={virtualType} />}
      </div>
      <div className="evidence-slot">
        {!isReadonly && virtualType !== "suggestion" && <EvidenceSelector />}
      </div>
      {!isVirtualItem && <PublishReachChip />}
      {!isEmptySemanticID(rowID) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
