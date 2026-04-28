import React from "react";
import { Map, List } from "immutable";
import {
  isSearchId,
  parseSearchId,
  getSearchNodes,
  shortID,
} from "./core/connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { deduplicateRefsByContext, findRefsToNode } from "./semanticProjection";
import { useCurrentPane } from "./SplitPanesContext";
import { newDB } from "./core/knowledge";
import { getLocalSearchResultIDs } from "./localSearch";

function SearchCrefBuilder({
  children,
  searchId,
  foundSemanticIDs,
}: {
  children: React.ReactNode;
  searchId: ID;
  foundSemanticIDs: List<ID>;
}): JSX.Element {
  const { knowledgeDBs, semanticIndex, user } = useData();
  const pane = useCurrentPane();
  const effectiveAuthor = pane.author;

  const uniqueSemanticIDs = foundSemanticIDs.toSet().toList();
  const crefItems = uniqueSemanticIDs.flatMap((semanticID) => {
    const refs = findRefsToNode(knowledgeDBs, semanticIndex, semanticID);
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

  const { node: searchNode, childNodes } = getSearchNodes(
    searchId,
    crefItems.toList(),
    user.publicKey,
    true
  );
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
    pane.stack[0] === searchId && pane.searchResultIDs
      ? List(pane.searchResultIDs)
      : getLocalSearchResultIDs(knowledgeDBs, query);

  return (
    <SearchCrefBuilder searchId={searchId} foundSemanticIDs={foundSemanticIDs}>
      {children}
    </SearchCrefBuilder>
  );
}
