import React from "react";
import { Map, List } from "immutable";
import { LOCAL } from "./core/nodeRef";
import {
  getNodeText,
  isSearchId,
  nodePathLabel,
  parseSearchId,
} from "./core/connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { findRefsToNode } from "./semanticProjection";
import { useCurrentPane } from "./SplitPanesContext";
import { newDB } from "./core/knowledge";
import { getLocalSearchResultIDs } from "./localSearch";
import { documentKeyOf, documentLinkPath } from "./core/Document";
import { newGraphNode } from "./core/nodeFactory";
import { fileLinkSpan, linkSpan, plainSpans } from "./core/nodeSpans";
import { graphLookupFromData, lookupNode } from "./core/graphLookup";

function SearchCrefBuilder({
  children,
  searchId,
  foundNodeIDs,
}: {
  children: React.ReactNode;
  searchId: ID;
  foundNodeIDs: List<ID>;
}): JSX.Element {
  const data = useData();
  const { documents } = data;
  const graph = graphLookupFromData(data);

  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const crefItems = uniqueNodeIDs
    .flatMap((nodeID) => findRefsToNode(graph, nodeID))
    .sortBy((ref) => -ref.updated)
    .map((ref) => ref.nodeID);

  const searchNodeBase = {
    ...newGraphNode(plainSpans("")),
    id: searchId,
    root: searchId,
  };
  const childNodes = crefItems
    .toSet()
    .toList()
    .flatMap((nodeID): GraphNode[] => {
      const target = lookupNode(graph, nodeID, LOCAL);
      const targetNode = target?.node;
      if (!target || !targetNode) return [];
      const targetDocument =
        targetNode.docId && !targetNode.parent
          ? documents.get(documentKeyOf(target.ref.sourceId, targetNode.docId))
          : undefined;
      const primaryTargetDocument =
        target.ref.sourceId === LOCAL &&
        targetDocument?.topNodeShortIds[0] === targetNode.id
          ? targetDocument
          : undefined;
      const node = primaryTargetDocument
        ? newGraphNode(
            [
              fileLinkSpan(
                documentLinkPath(primaryTargetDocument),
                getNodeText(targetNode) ?? primaryTargetDocument.title
              ),
            ],
            {
              root: searchId,
              parent: searchId,
            }
          )
        : newGraphNode(
            [
              linkSpan(
                nodeID,
                nodePathLabel(
                  data.knowledgeDBs,
                  target.node,
                  target.ref.sourceId
                )
              ),
            ],
            {
              root: searchId,
              parent: searchId,
            }
          );
      return [
        {
          ...node,
          updated: searchNodeBase.updated,
        },
      ];
    });
  const searchNode = {
    ...searchNodeBase,
    children: childNodes.map((node) => node.id).toList(),
  };
  const syntheticEntries: [ID, GraphNode][] = [
    [searchId, searchNode],
    ...childNodes.map((node): [ID, GraphNode] => [node.id, node]).toArray(),
  ];

  const syntheticDB: KnowledgeData = {
    ...newDB(),
    nodes: Map<ID, GraphNode>(syntheticEntries),
  };

  const syntheticDBs: KnowledgeDBs = Map<SourceId, KnowledgeData>([
    [LOCAL, syntheticDB],
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
  const { knowledgeDBs } = useData();
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
  const foundNodeIDs =
    pane.searchQuery === query && pane.searchResultIDs
      ? List(pane.searchResultIDs)
      : getLocalSearchResultIDs(knowledgeDBs, query);

  return (
    <SearchCrefBuilder searchId={searchId} foundNodeIDs={foundNodeIDs}>
      {children}
    </SearchCrefBuilder>
  );
}
