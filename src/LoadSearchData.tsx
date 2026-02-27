import React from "react";
import { Map, List } from "immutable";
import {
  isSearchId,
  parseSearchId,
  getSearchRelations,
  findRefsToNode,
  deduplicateRefsByContext,
  createConcreteRefId,
} from "./connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { useReadRelays } from "./relays";
import { useSearchQuery, filterForKeyword } from "./components/SearchModal";
import { LoadData } from "./dataQuery";
import { useCurrentPane } from "./SplitPanesContext";

function getAllNodesFromDBs(knowledgeDBs: KnowledgeDBs): Map<string, KnowNode> {
  return knowledgeDBs.reduce(
    (acc, db) => acc.merge(db.nodes),
    Map<string, KnowNode>()
  );
}

function SearchCrefBuilder({
  children,
  searchId,
  foundNodeIDs,
  searchNodes,
}: {
  children: React.ReactNode;
  searchId: ID;
  foundNodeIDs: List<ID>;
  searchNodes: Map<ID, KnowNode>;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const pane = useCurrentPane();
  const effectiveAuthor = pane.author;

  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const crefItems = uniqueNodeIDs.flatMap((nodeID) => {
    const refs = findRefsToNode(knowledgeDBs, nodeID);
    const deduped = deduplicateRefsByContext(refs, effectiveAuthor);
    if (deduped.size === 0) {
      return List<ID | LongID>();
    }
    return deduped.map((ref) =>
      createConcreteRefId(ref.relationID, ref.targetNode)
    );
  });

  const searchRelations = getSearchRelations(
    searchId,
    crefItems.toList(),
    user.publicKey
  );

  const syntheticDB: KnowledgeData = {
    nodes: searchNodes as Map<ID, KnowNode>,
    relations: Map<ID, Relations>([[searchId, searchRelations]]),
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
  nodeIDs,
}: {
  children: React.ReactNode;
  nodeIDs: (ID | LongID)[];
}): JSX.Element {
  const { relaysInfos, knowledgeDBs } = useData();
  const relays = useReadRelays({ user: true, contacts: true });

  const nip50Relays = relays.filter((r) => {
    return relaysInfos.get(r.url)?.supported_nips?.includes(50);
  });

  const searchEntries = nodeIDs
    .filter((id) => isSearchId(id as ID))
    .map((id) => ({ id, query: parseSearchId(id as ID) }))
    .filter(
      (entry): entry is { id: ID | LongID; query: string } => !!entry.query
    );

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
  const foundNodeIDs = List(allSearchResults.keySeq().toArray() as ID[]);

  return (
    <LoadData nodeIDs={foundNodeIDs.toArray()} referencedBy>
      <SearchCrefBuilder
        searchId={searchId}
        foundNodeIDs={foundNodeIDs}
        searchNodes={allSearchResults as Map<ID, KnowNode>}
      >
        {children}
      </SearchCrefBuilder>
    </LoadData>
  );
}
