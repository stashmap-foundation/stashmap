import React, { useEffect, useRef, useState } from "react";
import { Filter } from "nostr-tools";
import { Set } from "immutable";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import {
  splitID,
  isConcreteRefId,
  parseConcreteRefId,
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
  getRelationStack,
} from "./connections";
import { getTextHashForSemanticID } from "./semanticProjection";
import { REFERENCED_BY } from "./constants";
import { useCurrentPane } from "./SplitPanesContext";
import { useData } from "./DataContext";
import { useApis } from "./Apis";
import { useDocumentStore } from "./DocumentStore";
import { RegisterQuery, extractIDsFromQueries } from "./LoadingStatus";
import { useReadRelays } from "./relays";
import { useEventQuery } from "./commons/useNostrQuery";

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

function addValueToFilter(
  filter: Filter,
  value: string,
  tag: `#${string}`
): Filter {
  const values = filter[tag] || [];
  if (values.includes(value)) {
    return filter;
  }
  return {
    ...filter,
    [tag]: [...values, value],
  };
}

function getDocumentSemanticQueryIDs(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  id: LongID | ID
): Array<LongID | ID> {
  const textHash = getTextHashForSemanticID(knowledgeDBs, id, myself);
  return textHash && textHash !== id ? [id, textHash] : [id];
}

type Filters = {
  documentByRelation: Filter;
  documentBySemantic: Filter;
  documentBySystemRole: Filter;
  deleteFilter: Filter;
  authors: PublicKey[];
  systemRoleAuthors: PublicKey[];
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
  const { authors, systemRoleAuthors } = filters;
  return [
    sanitizeFilter({ ...filters.documentByRelation, authors }, "#r"),
    sanitizeFilter({ ...filters.documentBySemantic, authors }, "#n"),
    sanitizeFilter(
      { ...filters.documentBySystemRole, authors: systemRoleAuthors },
      "#s"
    ),
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

export function addSystemRoleToFilters(
  filters: Filters,
  systemRole: RootSystemRole
): Filters {
  return {
    ...filters,
    documentBySystemRole: addValueToFilter(
      filters.documentBySystemRole,
      systemRole,
      "#s"
    ),
  };
}

export function addItemToFilters(
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
      return addItemToFilters(
        withRelation,
        targetRelation.textHash,
        knowledgeDBs,
        myself,
        includeListQuery
      );
    }
  }

  const baseFilters = getDocumentSemanticQueryIDs(
    knowledgeDBs,
    myself,
    id
  ).reduce(
    (acc, queryID) => ({
      ...addAuthorFromIDToFilters(acc, id),
      documentBySemantic: addIDToFilter(acc.documentBySemantic, queryID, "#n"),
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
  return getDocumentSemanticQueryIDs(knowledgeDBs, myself, id).reduce(
    (acc, queryID) => ({
      ...addAuthorFromIDToFilters(acc, id),
      documentBySemantic: addIDToFilter(acc.documentBySemantic, queryID, "#n"),
    }),
    filters
  );
}

export function addListToFilters(
  filters: Filters,
  listID: LongID,
  itemID: LongID | ID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): Filters {
  if (listID === REFERENCED_BY) {
    return addReferencedByToFilters(filters, itemID, knowledgeDBs, myself);
  }

  return {
    ...addRelationIDToFilters(filters, listID),
    documentBySemantic: getDocumentSemanticQueryIDs(
      knowledgeDBs,
      myself,
      itemID
    ).reduce(
      (acc, queryID) => addIDToFilter(acc, queryID, "#n"),
      filters.documentBySemantic
    ),
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
    documentBySemantic: {
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    documentBySystemRole: {
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    deleteFilter: {
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
    },
    authors,
    systemRoleAuthors: [myself],
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

  const addDocumentEvents = useDocumentStore()?.addEvents;

  const disabled = isOnlyDelete(filters) || filters.length === 0;
  const { events, eose } = useEventQuery(relayPool, filters, {
    readFromRelays: useReadRelays({
      user: true,
      contacts: true,
    }),
    enabled: !disabled,
  });

  useEffect(() => {
    if (addDocumentEvents && events.size > 0) {
      addDocumentEvents(events);
    }
  }, [addDocumentEvents, events]);

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
  itemIDs,
  systemRoles,
  referencedBy,
  lists,
}: {
  children: React.ReactNode;
  itemIDs: ID[];
  systemRoles?: RootSystemRole[];
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

  const withItems = itemIDs.reduce((acc, itemID) => {
    const withItem = addItemToFilters(
      acc,
      itemID,
      knowledgeDBs,
      user.publicKey,
      lists
    );
    const withReferencedBy = referencedBy
      ? addReferencedByToFilters(withItem, itemID, knowledgeDBs, user.publicKey)
      : withItem;
    return withReferencedBy;
  }, baseFilter);

  const filter = (systemRoles || []).reduce(
    (acc, systemRole) => addSystemRoleToFilters(acc, systemRole),
    withItems
  );

  const filterArray = filtersToFilterArray(filter);
  const { allEventsProcessed } = useQueryKnowledgeData(filterArray);

  return (
    <RegisterQuery
      idsBeingQueried={extractIDsFromQueries(filterArray)}
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
        (acc, semanticID) =>
          addItemToFilters(acc, semanticID, knowledgeDBs, user.publicKey),
        withRelation
      )
    : withRelation;
  const filterArray = filtersToFilterArray(filter);
  useQueryKnowledgeData(filterArray);
  return <>{children}</>;
}
