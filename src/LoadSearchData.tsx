import React from "react";
import { Map, List } from "immutable";
import {
  getNodeText,
  isSearchId,
  parseSearchId,
  shortID,
} from "./core/connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { deduplicateRefsByContext, findRefsToNode } from "./semanticProjection";
import { useCurrentPane } from "./SplitPanesContext";
import { newDB } from "./core/knowledge";
import { getLocalSearchResultIDs } from "./localSearch";
import { documentKeyOf, documentLinkPath } from "./core/Document";
import { newGraphNode } from "./core/nodeFactory";
import { fileLinkSpan, linkSpan, plainSpans } from "./core/nodeSpans";
import {
  getNodeFromGraphData,
  getSourceNodeCandidates,
  projectKnowledgeDBs,
} from "./core/graphData";

function SearchCrefBuilder({
  children,
  searchId,
  foundSemanticIDs,
}: {
  children: React.ReactNode;
  searchId: ID;
  foundSemanticIDs: List<ID>;
}): JSX.Element {
  const data = useData();
  const { documents, user } = data;
  const knowledgeDBs = projectKnowledgeDBs(data);
  const pane = useCurrentPane();
  const effectiveAuthor = pane.author;

  const uniqueSemanticIDs = foundSemanticIDs.toSet().toList();
  const crefItems = uniqueSemanticIDs.flatMap((semanticID) => {
    const refs = findRefsToNode(knowledgeDBs, data, semanticID);
    const deduped = deduplicateRefsByContext(
      refs,
      knowledgeDBs,
      effectiveAuthor
    );
    if (deduped.size === 0) {
      return List<ID>();
    }
    return deduped.map((ref) => ref.nodeID as ID);
  });

  const searchNodeBase = {
    ...newGraphNode(user.publicKey, plainSpans(""), {
      semanticContext: List<ID>(),
    }),
    id: searchId as LongID,
    root: searchId as LongID,
  };
  const childNodes = crefItems
    .toSet()
    .toList()
    .map((nodeID): GraphNode => {
      const targetNode =
        getNodeFromGraphData(data, nodeID, effectiveAuthor as SourceId) ??
        getSourceNodeCandidates(data, nodeID)[0]?.node;
      const targetDocument =
        targetNode?.docId && !targetNode.parent
          ? documents.get(documentKeyOf(targetNode.author, targetNode.docId))
          : undefined;
      const primaryTargetDocument =
        targetNode &&
        targetDocument?.topNodeShortIds[0] === shortID(targetNode.id)
          ? targetDocument
          : undefined;
      const sourceAuthor = user.publicKey;
      const node = primaryTargetDocument
        ? newGraphNode(
            sourceAuthor,
            [
              fileLinkSpan(
                documentLinkPath(primaryTargetDocument),
                getNodeText(targetNode) ?? primaryTargetDocument.title
              ),
            ],
            {
              root: searchId as LongID,
              parent: searchId as LongID,
            }
          )
        : newGraphNode(sourceAuthor, [linkSpan(nodeID as LongID, "")], {
            root: searchId as LongID,
            parent: searchId as LongID,
          });
      return {
        ...node,
        updated: searchNodeBase.updated,
        virtualType: "search",
      };
    });
  const searchNode = {
    ...searchNodeBase,
    children: childNodes.map((node) => node.id).toList(),
  };
  const syntheticEntries: [ID, GraphNode][] = [
    [searchId, searchNode] as [ID, GraphNode],
    ...childNodes
      .map((node) => [shortID(node.id) as ID, node] as [ID, GraphNode])
      .toArray(),
  ];

  const syntheticDB: KnowledgeData = {
    ...newDB(),
    nodes: Map<ID, GraphNode>(syntheticEntries),
  };

  const syntheticDBs: KnowledgeDBs = Map<PublicKey, KnowledgeData>([
    [user.publicKey, syntheticDB],
  ]);

  return (
    <MergeKnowledgeDB knowledgeDBs={syntheticDBs}>{children}</MergeKnowledgeDB>
  );
}

export function LoadSearchData({
  children,
  itemIDs,
}: {
  children: React.ReactNode;
  itemIDs: ID[];
}): JSX.Element {
  const data = useData();
  const knowledgeDBs = projectKnowledgeDBs(data);
  const pane = useCurrentPane();

  const searchEntries = itemIDs
    .filter((id) => isSearchId(id as ID))
    .map((id) => ({ id, query: parseSearchId(id as ID) }))
    .filter((entry): entry is { id: ID; query: string } => !!entry.query);

  const firstSearch = searchEntries[0];
  const query = firstSearch?.query || "";

  if (!firstSearch) {
    return <>{children}</>;
  }

  const searchId = firstSearch.id as ID;
  const localSearchResultIDs = getLocalSearchResultIDs(knowledgeDBs, query);
  const providerSearchResultIDs =
    pane.searchQuery === query && pane.searchResultIDs
      ? List(pane.searchResultIDs)
      : List<ID>();
  const foundSemanticIDs = providerSearchResultIDs
    .concat(localSearchResultIDs)
    .toSet()
    .toList();

  return (
    <SearchCrefBuilder searchId={searchId} foundSemanticIDs={foundSemanticIDs}>
      {children}
    </SearchCrefBuilder>
  );
}
