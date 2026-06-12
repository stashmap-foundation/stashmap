import React from "react";
import { Map, List } from "immutable";
import { LOCAL } from "./core/nodeRef";
import { getNodeText, isSearchId, parseSearchId } from "./core/connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { deduplicateRefsByContext, findRefsToNode } from "./semanticProjection";
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
  foundSemanticIDs,
}: {
  children: React.ReactNode;
  searchId: ID;
  foundSemanticIDs: List<ID>;
}): JSX.Element {
  const data = useData();
  const { documents, knowledgeDBs } = data;
  const graph = graphLookupFromData(data);
  const pane = useCurrentPane();
  const effectiveAuthor = pane.sourceId;

  const uniqueSemanticIDs = foundSemanticIDs.toSet().toList();
  const crefItems = uniqueSemanticIDs.flatMap((semanticID) => {
    const refs = findRefsToNode(graph, semanticID);
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
    ...newGraphNode(plainSpans("")),
    id: searchId as ID,
    root: searchId as ID,
  };
  const childNodes = crefItems
    .toSet()
    .toList()
    .map((nodeID): GraphNode => {
      const target = lookupNode(graph, nodeID as ID, LOCAL);
      const targetNode = target?.node;
      const targetDocument =
        target && targetNode?.docId && !targetNode.parent
          ? documents.get(documentKeyOf(target.ref.sourceId, targetNode.docId))
          : undefined;
      const primaryTargetDocument =
        target &&
        targetNode &&
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
              root: searchId as ID,
              parent: searchId as ID,
            }
          )
        : newGraphNode([linkSpan(nodeID as ID, "")], {
            root: searchId as ID,
            parent: searchId as ID,
          });
      return {
        ...node,
        updated: searchNodeBase.updated,
      };
    });
  const searchNode = {
    ...searchNodeBase,
    children: childNodes.map((node) => node.id).toList(),
  };
  const syntheticEntries: [ID, GraphNode][] = [
    [searchId, searchNode] as [ID, GraphNode],
    ...childNodes.map((node) => [node.id, node] as [ID, GraphNode]).toArray(),
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
  const foundSemanticIDs =
    pane.searchQuery === query && pane.searchResultIDs
      ? List(pane.searchResultIDs)
      : getLocalSearchResultIDs(knowledgeDBs, query);

  return (
    <SearchCrefBuilder searchId={searchId} foundSemanticIDs={foundSemanticIDs}>
      {children}
    </SearchCrefBuilder>
  );
}
