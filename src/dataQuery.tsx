import React, { useEffect, useRef, useState } from "react";
import { Filter } from "nostr-tools";
import { Set } from "immutable";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_LIST,
  KIND_KNOWLEDGE_NODE,
  KIND_PROJECT,
} from "./nostr";
import { splitID } from "./connections";
import { REFERENCED_BY } from "./constants";
import { ADD_TO_NODE, getNodeFromID, useNodeID } from "./ViewContext";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { useApis } from "./Apis";
import { processEvents } from "./Data";
import { RegisterQuery, extractNodesFromQueries } from "./LoadingStatus";
import { isUserLoggedIn } from "./NostrAuthContext";
import { useReadRelays } from "./relays";
import { useEventQuery } from "./commons/useNostrQuery";

function addIDToFilter(
  filter: Filter,
  id: LongID | ID,
  tag: `#${string}`
): Filter {
  if (id === ADD_TO_NODE) {
    return filter;
  }
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

// {
//    KIND: [KIND_KNOWLEDGE_LIST],
//    #d: [relationID]
// }
// {
//    KIND: [KIND_KNOWLEDGE_NODE],
//    #d: [nodeID]
// }
// {
//    KIND: [KIND_KNOWLEDGE_LIST],
//    #k: [nodeID]
// }
//
type Filters = {
  knowledgeListbyID: Filter;
  knowledgeNodesByID: Filter;
  knowledgeListByHead: Filter;
  referencedBy: Filter;
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
    // No need for an author filter when loading a specific ID
    sanitizeFilter({ ...filters.knowledgeListbyID, authors }, "#d"),
    sanitizeFilter({ ...filters.knowledgeNodesByID, authors }, "#d"),
    sanitizeFilter({ ...filters.knowledgeListByHead, authors }, "#k"),
    sanitizeFilter({ ...filters.referencedBy, authors }, "#i"),
    sanitizeFilter({ ...filters.deleteFilter, authors }, "#k"),
  ].filter((f) => f !== undefined) as Filter[];
}

function addAuthorFromIDToFilters(filters: Filters, id: LongID | ID): Filters {
  if (id === ADD_TO_NODE) {
    return filters;
  }
  const author = splitID(id)[0];
  const isNewAuthor = author && !filters.authors.includes(author);
  const authors = isNewAuthor ? [...filters.authors, author] : filters.authors;

  return {
    ...filters,
    authors,
  };
}

export function addNodeToFilters(filters: Filters, id: LongID | ID): Filters {
  return {
    ...addAuthorFromIDToFilters(filters, id),
    knowledgeNodesByID: addIDToFilter(filters.knowledgeNodesByID, id, "#d"),
    knowledgeListByHead: addIDToFilter(filters.knowledgeListByHead, id, "#k"),
  };
}

export function addReferencedByToFilters(
  filters: Filters,
  id: LongID | ID
): Filters {
  const filter = filters.referencedBy;
  const d = filter["#i"] || [];
  const updatedFilter = {
    ...filter,
    "#i": [...d, id],
  };
  return {
    ...addAuthorFromIDToFilters(filters, id),
    referencedBy: updatedFilter,
  };
}

export function addListToFilters(
  filters: Filters,
  listID: LongID,
  nodeID: LongID | ID
): Filters {
  if (listID === REFERENCED_BY) {
    return addReferencedByToFilters(filters, nodeID);
  }

  return {
    ...addAuthorFromIDToFilters(filters, listID),
    knowledgeListbyID: addIDToFilter(filters.knowledgeListbyID, listID, "#d"),
  };
}

export function createBaseFilter(
  contacts: Contacts,
  projectMembers: Members,
  myself: PublicKey
): Filters {
  const authors = [
    ...contacts.keySeq().toArray(),
    ...projectMembers.keySeq().toArray(),
    myself,
  ];
  return {
    knowledgeListbyID: {
      kinds: [KIND_KNOWLEDGE_LIST],
    },
    knowledgeNodesByID: {
      kinds: [KIND_KNOWLEDGE_NODE, KIND_PROJECT],
    },
    knowledgeListByHead: {
      kinds: [KIND_KNOWLEDGE_LIST],
    },
    referencedBy: {
      kinds: [KIND_KNOWLEDGE_LIST],
    },
    deleteFilter: {
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_LIST}`, `${KIND_KNOWLEDGE_NODE}`],
    },
    authors,
  } as Filters;
}

function isOnlyDelete(filters: Filter[]): boolean {
  return !!(
    filters.length === 1 &&
    filters[0].kinds?.includes(KIND_DELETE) &&
    filters[0].kinds.length === 1
  );
}

export function useQueryKnowledgeData(filters: Filter[]): {
  knowledgeDBs: KnowledgeDBs;
  eose: boolean;
  allEventsProcessed: boolean;
} {
  const { publishEventsStatus } = useData();
  const unpublishedEvents = publishEventsStatus.unsignedEvents;
  const { relayPool, eventLoadingTimeout } = useApis();
  const [allEventsProcessed, setAllEventsProcessed] = useState(false);
  const setAllEventsProcessedTimeout = useRef<number | undefined>(undefined);

  const disabled = isOnlyDelete(filters) || filters.length === 0;
  const { events, eose } = useEventQuery(relayPool, filters, {
    readFromRelays: useReadRelays({
      user: true,
      project: true,
      contacts: true,
    }),
    enabled: !disabled,
  });

  /**
   * Sometimes eose gets fired before all events are processed.
   *
   * This is a workaround to wait for all events to be processed before setting allEventsProcessed to true.
   * With dashboards with a lot of events a lot of time can pass between eose and the first
   * event being processed, therefore we need to select a huge timeout. User will see an
   * error message instead of the loading indicator if a note was not loaded by then.
   */
  useEffect(() => {
    if (!eose || disabled) {
      return;
    }
    clearTimeout(setAllEventsProcessedTimeout.current);
    // eslint-disable-next-line functional/immutable-data
    setAllEventsProcessedTimeout.current = setTimeout(() => {
      setAllEventsProcessed(true);
    }, eventLoadingTimeout) as unknown as number;
  }, [events.size, eose, JSON.stringify(filters), disabled]);

  const processedEvents = processEvents(
    events.valueSeq().toList().merge(unpublishedEvents)
  );
  const knowledgeDBs = processedEvents.map((data) => data.knowledgeDB);
  return { knowledgeDBs, eose, allEventsProcessed };
}

export function LoadNode({
  children,
  waitForEose,
  referencedBy,
}: {
  children: React.ReactNode;
  waitForEose?: boolean;
  referencedBy?: boolean;
}): JSX.Element {
  const [nodeID] = useNodeID();
  const { user, contacts, projectMembers } = useData();

  const nodeFilter = addNodeToFilters(
    createBaseFilter(contacts, projectMembers, user.publicKey),
    nodeID
  );
  const filter = referencedBy
    ? addReferencedByToFilters(nodeFilter, nodeID)
    : nodeFilter;
  const filterArray = filtersToFilterArray(filter);
  const { knowledgeDBs, eose, allEventsProcessed } =
    useQueryKnowledgeData(filterArray);
  if (isUserLoggedIn(user) && waitForEose === true && !eose) {
    const haveNode = getNodeFromID(knowledgeDBs, nodeID, user.publicKey);
    if (!haveNode) {
      return <div className="loading" aria-label="loading" />;
    }
  }
  return (
    <RegisterQuery
      nodesBeeingQueried={extractNodesFromQueries(filterArray)}
      allEventsProcessed={allEventsProcessed}
    >
      <MergeKnowledgeDB knowledgeDBs={knowledgeDBs}>
        {children}
      </MergeKnowledgeDB>
    </RegisterQuery>
  );
}
