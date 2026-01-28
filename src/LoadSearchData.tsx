import React from "react";
import { Map, List } from "immutable";
import { isSearchId, parseSearchId, getSearchRelations } from "./connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { useReadRelays } from "./relays";
import { useSearchQuery } from "./components/SearchModal";

export function LoadSearchData({
  children,
  nodeIDs,
}: {
  children: React.ReactNode;
  nodeIDs: (ID | LongID)[];
}): JSX.Element {
  const { user, relaysInfos } = useData();
  const relays = useReadRelays({ user: true, contacts: true });

  const nip50Relays = relays.filter((r) => {
    return relaysInfos.get(r.url)?.supported_nips?.includes(50);
  });

  const searchEntries = nodeIDs
    .filter((id) => isSearchId(id as ID))
    .map((id) => ({ id, query: parseSearchId(id as ID) }))
    .filter((entry): entry is { id: ID | LongID; query: string } => !!entry.query);

  const firstSearch = searchEntries[0];
  const query = firstSearch?.query || "";

  console.log("LoadSearchData", { nodeIDs, query, firstSearch, relaysCount: relays.length, rootID: nodeIDs[nodeIDs.length - 1] });

  const [searchResults] = useSearchQuery(query, nip50Relays, true);
  const [slowSearchResults] = useSearchQuery(query, relays, false);

  const allSearchResults = slowSearchResults.merge(searchResults);

  console.log("LoadSearchData results", { searchResultsCount: searchResults.size, slowSearchResultsCount: slowSearchResults.size, allCount: allSearchResults.size });

  if (!firstSearch) {
    return <>{children}</>;
  }

  const searchId = firstSearch.id as ID;
  const foundNodeIDs = List(allSearchResults.keySeq().toArray() as ID[]);
  const searchRelations = getSearchRelations(
    searchId,
    foundNodeIDs,
    user.publicKey
  );

  console.log("LoadSearchData synthetic", { searchId, foundNodeIDs: foundNodeIDs.toArray(), searchRelations });

  const syntheticDB: KnowledgeData = {
    nodes: allSearchResults as Map<ID, KnowNode>,
    relations: Map<ID, Relations>([[searchId, searchRelations]]),
  };

  const syntheticDBs: KnowledgeDBs = Map<PublicKey, KnowledgeData>([
    [user.publicKey, syntheticDB],
  ]);

  return (
    <MergeKnowledgeDB knowledgeDBs={syntheticDBs}>{children}</MergeKnowledgeDB>
  );
}
