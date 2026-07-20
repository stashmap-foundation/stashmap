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
import { LOCAL } from "../core/nodeRef";
import { Document, getDocumentByIdOrFilePath } from "../core/Document";
import { graphLookupFromData, lookupNode } from "../core/graphLookup";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { getNodeDocumentId } from "../core/plan";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

export function usePublishedPaneDocument(): Document | undefined {
  const data = useData();
  const pane = useCurrentPane();
  if (pane.sourceId !== LOCAL) return undefined;
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

export function RightMenu(): JSX.Element {
  const { virtualType } = useRow();
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "version" ||
    virtualType === "related-source";
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
