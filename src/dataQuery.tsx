import React, { useEffect, useRef, useState } from "react";
import { Filter } from "nostr-tools";
import { List, Set } from "immutable";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import {
  splitID,
  isConcreteRefId,
  parseConcreteRefId,
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
  getTextHashForSemanticID,
  getRelationStack,
} from "./connections";
import { parseRef } from "./buildReferenceRow";
import { REFERENCED_BY } from "./constants";
import {
  getItemIDFromView,
  useCurrentItemID,
  getContext,
  getEffectiveAuthor,
  getRootForView,
  useViewPath,
  ViewPath,
} from "./ViewContext";
import { usePaneStack, useCurrentPane } from "./SplitPanesContext";
import { useData } from "./DataContext";
import { useApis } from "./Apis";
import { RegisterQuery, extractNodesFromQueries } from "./LoadingStatus";
import { useReadRelays } from "./relays";
import { useEventQuery } from "./commons/useNostrQuery";
import { useEventCache } from "./EventCache";

function addIDToFilter(
  filter: Filter,
  id: LongID | ID,
  tag: `#${string}`
): Filter {
  const d = filter[tag] || [];
  const local = splitID(id)[1];
  // TODO: Add unknown remotes? Or even better create a filter for each unknown remote to query specific ids
  // strip index from ID when we look for a node belonging to a collection

  if (d.includes(local)) {
    return filter;
  }
  return {
    ...filter,
    [tag]: [...d, local],
  };
}

function getDocumentNodeQueryIDs(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  id: LongID | ID
): Array<LongID | ID> {
  const queryIDs: Array<LongID | ID> = [id];
  const textHash = getTextHashForSemanticID(knowledgeDBs, id, myself);
  if (textHash && !queryIDs.includes(textHash)) {
    queryIDs.push(textHash);
  }
  return queryIDs;
}

type Filters = {
  documentByRelation: Filter;
  documentByNode: Filter;
  documentByContext: Filter;
  deleteFilter: Filter;
  authors: PublicKey[];
};

export function sanitizeFilter(
  filter: Filter,
  tag: `#${string}`
): Filter | undefined {
  const values = Set(filter[tag] || []).toArray();
  if (values.length === 0) {
    return undefined;
  }
  return {
    ...filter,
    [tag]: values,
  };
}

export function filtersToFilterArray(filters: Filters): Filter[] {
  const { authors } = filters;
  return [
    sanitizeFilter({ ...filters.documentByRelation, authors }, "#r"),
    sanitizeFilter({ ...filters.documentByNode, authors }, "#n"),
    sanitizeFilter({ ...filters.documentByContext, authors }, "#c"),
    sanitizeFilter({ ...filters.deleteFilter, authors }, "#k"),
  ].filter((f) => f !== undefined) as Filter[];
}

function addAuthorFromIDToFilters(filters: Filters, id: LongID | ID): Filters {
  const author = splitID(id)[0];
  const isNewAuthor = author && !filters.authors.includes(author);
  const authors = isNewAuthor ? [...filters.authors, author] : filters.authors;

  return {
    ...filters,
    authors,
  };
}

export function addRelationIDToFilters(
  filters: Filters,
  relationID: LongID
): Filters {
  return {
    ...addAuthorFromIDToFilters(filters, relationID as ID),
    documentByRelation: addIDToFilter(
      filters.documentByRelation,
      relationID,
      "#r"
    ),
  };
}

export function addNodeToFilters(
  filters: Filters,
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  includeListQuery: boolean = false
): Filters {
  if (isConcreteRefId(id)) {
    const parsed = parseConcreteRefId(id);
    if (parsed) {
      const withRelation = addRelationIDToFilters(filters, parsed.relationID);
      const targetRelation = getConcreteRefTargetRelation(
        knowledgeDBs,
        id,
        myself
      );
      if (!targetRelation) {
        return withRelation;
      }
      return addNodeToFilters(
        withRelation,
        targetRelation.textHash,
        knowledgeDBs,
        myself,
        includeListQuery
      );
    }
  }

  const baseFilters = getDocumentNodeQueryIDs(knowledgeDBs, myself, id).reduce(
    (acc, queryID) => ({
      ...addAuthorFromIDToFilters(acc, id),
      documentByNode: addIDToFilter(acc.documentByNode, queryID, "#n"),
    }),
    filters
  );

  if (!includeListQuery) {
    return baseFilters;
  }

  return baseFilters;
}

export function addReferencedByToFilters(
  filters: Filters,
  id: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): Filters {
  return getDocumentNodeQueryIDs(knowledgeDBs, myself, id).reduce(
    (acc, queryID) => ({
      ...addAuthorFromIDToFilters(acc, id),
      documentByNode: addIDToFilter(acc.documentByNode, queryID, "#n"),
    }),
    filters
  );
}

export function addListToFilters(
  filters: Filters,
  listID: LongID,
  nodeID: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): Filters {
  if (listID === REFERENCED_BY) {
    return addReferencedByToFilters(filters, nodeID, knowledgeDBs, myself);
  }

  return {
    ...addRelationIDToFilters(filters, listID),
    documentByNode: getDocumentNodeQueryIDs(
      knowledgeDBs,
      myself,
      nodeID
    ).reduce(
      (acc, queryID) => addIDToFilter(acc, queryID, "#n"),
      filters.documentByNode
    ),
  };
}

export function addDescendantsToFilters(
  filters: Filters,
  nodeID: LongID | ID
): Filters {
  return {
    ...filters,
    documentByContext: addIDToFilter(filters.documentByContext, nodeID, "#c"),
    documentByNode: addIDToFilter(filters.documentByNode, nodeID, "#n"),
  };
}

export function createBaseFilter(
  contacts: Contacts,
  projectMembers: Members,
  myself: PublicKey,
  paneAuthor?: PublicKey
): Filters {
  const authors = [
    ...contacts.keySeq().toArray(),
    ...projectMembers.keySeq().toArray(),
    myself,
    ...(paneAuthor && paneAuthor !== myself && !contacts.has(paneAuthor)
      ? [paneAuthor]
      : []),
  ];
  return {
    documentByRelation: {
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    documentByNode: {
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    documentByContext: {
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    deleteFilter: {
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
    },
    authors,
  };
}

function isOnlyDelete(filters: Filter[]): boolean {
  return !!(
    filters.length === 1 &&
    filters[0].kinds?.includes(KIND_DELETE) &&
    filters[0].kinds.length === 1
  );
}

export function useQueryKnowledgeData(filters: Filter[]): {
  allEventsProcessed: boolean;
} {
  const { relayPool, eventLoadingTimeout } = useApis();
  const [allEventsProcessed, setAllEventsProcessed] = useState(false);
  const setAllEventsProcessedTimeout = useRef<number | undefined>(undefined);

  const eventCache = useEventCache();

  const disabled = isOnlyDelete(filters) || filters.length === 0;
  const { events, eose } = useEventQuery(relayPool, filters, {
    readFromRelays: useReadRelays({
      user: true,
      contacts: true,
    }),
    enabled: !disabled,
  });

  useEffect(() => {
    if (eventCache && events.size > 0) {
      eventCache.addEvents(events);
    }
  }, [eventCache, events]);

  const serializedFilters = JSON.stringify(filters);

  useEffect(() => {
    setAllEventsProcessed(false);
  }, [serializedFilters]);

  useEffect(() => {
    if (!eose || disabled) {
      return;
    }
    clearTimeout(setAllEventsProcessedTimeout.current);
    // eslint-disable-next-line functional/immutable-data
    setAllEventsProcessedTimeout.current = setTimeout(() => {
      setAllEventsProcessed(true);
    }, eventLoadingTimeout) as unknown as number;
  }, [events.size, eose, serializedFilters, disabled, eventLoadingTimeout]);

  return { allEventsProcessed };
}

export function LoadData({
  children,
  nodeIDs,
  descendants,
  referencedBy,
  lists,
}: {
  children: React.ReactNode;
  nodeIDs: ID[];
  descendants?: boolean;
  referencedBy?: boolean;
  lists?: boolean;
}): JSX.Element {
  const { user, contacts, projectMembers, knowledgeDBs } = useData();
  const effectiveAuthor = useCurrentPane().author;

  const baseFilter = createBaseFilter(
    contacts,
    projectMembers,
    user.publicKey,
    effectiveAuthor
  );

  const filter = nodeIDs.reduce((acc, nodeID) => {
    const withNode = addNodeToFilters(
      acc,
      nodeID,
      knowledgeDBs,
      user.publicKey,
      lists
    );
    const withDescendants = descendants
      ? addDescendantsToFilters(withNode, nodeID)
      : withNode;
    const withReferencedBy = referencedBy
      ? addReferencedByToFilters(
          withDescendants,
          nodeID,
          knowledgeDBs,
          user.publicKey
        )
      : withDescendants;
    return withReferencedBy;
  }, baseFilter);

  const filterArray = filtersToFilterArray(filter);
  const { allEventsProcessed } = useQueryKnowledgeData(filterArray);

  return (
    <RegisterQuery
      nodesBeeingQueried={extractNodesFromQueries(filterArray)}
      allEventsProcessed={allEventsProcessed}
    >
      {children}
    </RegisterQuery>
  );
}

export function LoadRelationData({
  children,
  relationID,
}: {
  children: React.ReactNode;
  relationID: LongID;
}): JSX.Element {
  const { knowledgeDBs, user, contacts, projectMembers } = useData();
  const effectiveAuthor = useCurrentPane().author;
  const baseFilter = createBaseFilter(
    contacts,
    projectMembers,
    user.publicKey,
    effectiveAuthor
  );
  const withRelation = addRelationIDToFilters(baseFilter, relationID);
  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    relationID,
    effectiveAuthor
  );
  const filter = relation
    ? getRelationStack(knowledgeDBs, relation).reduce(
        (acc, nodeID) =>
          addNodeToFilters(acc, nodeID, knowledgeDBs, user.publicKey),
        withRelation
      )
    : withRelation;
  const filterArray = filtersToFilterArray(filter);
  useQueryKnowledgeData(filterArray);
  return <>{children}</>;
}
