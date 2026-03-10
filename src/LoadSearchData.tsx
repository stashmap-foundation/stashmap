import React from "react";
import { Map, List } from "immutable";
import {
  isSearchId,
  parseSearchId,
  getSearchRelations,
  createConcreteRefId,
  buildTextNodesFromRelations,
} from "./connections";
import type { TextSeed } from "./connections";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { deduplicateRefsByContext, findRefsToNode } from "./semanticProjection";
import { useReadRelays } from "./relays";
import { useSearchQuery, filterForKeyword } from "./components/SearchModal";
import { LoadData } from "./dataQuery";
import { useCurrentPane } from "./SplitPanesContext";
import { newDB } from "./knowledge";

function getAllNodesFromDBs(knowledgeDBs: KnowledgeDBs): Map<string, TextSeed> {
  return buildTextNodesFromRelations(
    knowledgeDBs.valueSeq().flatMap((db) => db.relations.valueSeq())
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
  const { knowledgeDBs, user } = useData();
  const pane = useCurrentPane();
  const effectiveAuthor = pane.author;

  const uniqueSemanticIDs = foundSemanticIDs.toSet().toList();
  const crefItems = uniqueSemanticIDs.flatMap((semanticID) => {
    const refs = findRefsToNode(knowledgeDBs, semanticID);
    const deduped = deduplicateRefsByContext(
      refs,
      knowledgeDBs,
      effectiveAuthor
    );
    if (deduped.size === 0) {
      return List<ID | LongID>();
    }
    return deduped.map((ref) => createConcreteRefId(ref.relationID));
  });

  const searchRelations = getSearchRelations(
    searchId,
    crefItems.toList(),
    user.publicKey
  );

  const syntheticDB: KnowledgeData = {
    ...newDB(),
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
  itemIDs,
}: {
  children: React.ReactNode;
  itemIDs: (ID | LongID)[];
}): JSX.Element {
  const { relaysInfos, knowledgeDBs } = useData();
  const relays = useReadRelays({ user: true, contacts: true });

  const nip50Relays = relays.filter((r) => {
    return relaysInfos.get(r.url)?.supported_nips?.includes(50);
  });

  const searchEntries = itemIDs
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
  const foundSemanticIDs = List(allSearchResults.keySeq().toArray() as ID[]);

  return (
    <LoadData itemIDs={foundSemanticIDs.toArray()} referencedBy>
      <SearchCrefBuilder
        searchId={searchId}
        foundSemanticIDs={foundSemanticIDs}
      >
        {children}
      </SearchCrefBuilder>
    </LoadData>
  );
}
