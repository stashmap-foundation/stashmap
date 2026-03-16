import React from "react";
import { Map, List } from "immutable";
import {
  isSearchId,
  parseSearchId,
  getSearchNodes,
  buildTextNodesFromGraphNodes,
  shortID,
} from "./connections";
import type { TextSeed } from "./connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { deduplicateRefsByContext, findRefsToNode } from "./semanticProjection";
import { useReadRelays } from "./relays";
import { useSearchQuery, filterForKeyword } from "./components/SearchModal";
import { useCurrentPane } from "./features/navigation/SplitPanesContext";
import { newDB } from "./knowledge";

function getAllNodesFromDBs(knowledgeDBs: KnowledgeDBs): Map<string, TextSeed> {
  return buildTextNodesFromGraphNodes(
    knowledgeDBs.valueSeq().flatMap((db) => db.nodes.valueSeq())
  ) as Map<string, TextSeed>;
}

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
  const { relaysInfos, knowledgeDBs } = useData();
  const relays = useReadRelays({ user: true, contacts: true });

  const nip50Relays = relays.filter((r) => {
    return relaysInfos.get(r.url)?.supported_nips?.includes(50);
  });

  const searchEntries = itemIDs
    .filter((id) => isSearchId(id as ID))
    .map((id) => ({ id, query: parseSearchId(id as ID) }))
    .filter((entry): entry is { id: ID; query: string } => !!entry.query);

  const firstSearch = searchEntries[0];
  const query = firstSearch?.query || "";

  const [searchResults] = useSearchQuery(query, nip50Relays, true);
  const [slowSearchResults] = useSearchQuery(query, relays, false);

  const localNodes = getAllNodesFromDBs(knowledgeDBs);
  const localSearchResults = filterForKeyword(localNodes, query);

  const allSearchResults = localSearchResults.merge(
    slowSearchResults.merge(searchResults)
  );

  if (!firstSearch) {
    return <>{children}</>;
  }

  const searchId = firstSearch.id as ID;
  const foundSemanticIDs = List(allSearchResults.keySeq().toArray() as ID[]);

  return (
    <SearchCrefBuilder searchId={searchId} foundSemanticIDs={foundSemanticIDs}>
      {children}
    </SearchCrefBuilder>
  );
}
