import React from "react";
import {
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentNode,
  useRow,
} from "../rowModel";
import { isEmptyNodeID } from "../core/connections";
import { useCurrentPane } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { usePlanner } from "../planner";
import { LOCAL } from "../core/nodeRef";
import { Document, getDocumentByIdOrFilePath } from "../core/Document";
import { graphLookupFromData, lookupNode } from "../core/graphLookup";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { getNodeDocumentId, planSetDocumentPublishState } from "../core/plan";
import { unpublishedLinkTarget } from "./publishReach";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

// The pane's document, but only when it is published — the condition for
// reach chips to appear on its link rows.
export function usePublishedPaneDocument(): Document | undefined {
  const data = useData();
  const pane = useCurrentPane();
  if (pane.sourceId !== LOCAL) {
    return undefined;
  }
  const graph = graphLookupFromData(data);
  const rootNode = pane.rootNodeId
    ? lookupNode(graph, pane.rootNodeId, pane.sourceId)?.node
    : undefined;
  const docId =
    pane.documentId ??
    (rootNode
      ? getNodeDocumentId({ knowledgeDBs: data.knowledgeDBs }, rootNode)
      : undefined);
  const document = docId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        LOCAL,
        docId
      )
    : undefined;
  return document && publishStateOf(document.frontMatter)
    ? document
    : undefined;
}

// A link row inside a published document whose target isn't shared: a
// worded chip inline after the link text, in the dashed
// click-to-publish frame the header's publish button also wears.
// Always visible: this is state, not a hover control.
export function PublishReachChip({
  paneDocument,
  node,
}: {
  paneDocument: Document;
  node: GraphNode;
}): JSX.Element | null {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();

  const target = unpublishedLinkTarget(
    data.knowledgeDBs,
    data.documents,
    data.documentByFilePath,
    paneDocument,
    node
  );
  if (!target) {
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
      title="Readers of this document can see this link but can't open it. Click to publish."
    >
      not published
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
      {!isEmptyNodeID(currentNode.id) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
