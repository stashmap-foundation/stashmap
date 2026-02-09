import React, { useEffect, useRef, useState } from "react";
import { Filter } from "nostr-tools";
import { List, Set } from "immutable";
import { KIND_DELETE, KIND_KNOWLEDGE_LIST, KIND_KNOWLEDGE_NODE } from "./nostr";
import {
  splitID,
  isRefId,
  extractNodeIdsFromRefId,
  VERSIONS_NODE_ID,
} from "./connections";
import { REFERENCED_BY } from "./constants";
import {
  getNodeFromID,
  getNodeIDFromView,
  useNodeID,
  getVersionsRelations,
  getContext,
  getEffectiveAuthor,
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
  knowledgeListByContext: Filter;
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
    sanitizeFilter({ ...filters.knowledgeListbyID, authors }, "#d"),
    // Content-addressed nodes can be found by ID regardless of author
    sanitizeFilter({ ...filters.knowledgeNodesByID }, "#d"),
    sanitizeFilter({ ...filters.knowledgeListByHead, authors }, "#k"),
    sanitizeFilter({ ...filters.knowledgeListByContext, authors }, "#c"),
    sanitizeFilter({ ...filters.referencedBy, authors }, "#i"),
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

export function addNodeToFilters(
  filters: Filters,
  id: LongID | ID,
  includeListQuery: boolean = false
): Filters {
  if (isRefId(id)) {
    const nodeIds = extractNodeIdsFromRefId(id);
    return nodeIds.reduce(
      (acc, nodeId) => addNodeToFilters(acc, nodeId, includeListQuery),
      filters
    );
  }

  const baseFilters = {
    ...addAuthorFromIDToFilters(filters, id),
    knowledgeNodesByID: addIDToFilter(filters.knowledgeNodesByID, id, "#d"),
  };

  if (!includeListQuery) {
    return baseFilters;
  }

  return {
    ...baseFilters,
    knowledgeListByHead: addIDToFilter(
      addIDToFilter(filters.knowledgeListByHead, id, "#k"),
      VERSIONS_NODE_ID,
      "#k"
    ),
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
    // Also query for relations where this node is the head (has direct children)
    knowledgeListByHead: addIDToFilter(filters.knowledgeListByHead, id, "#k"),
  };
}

export function addRelationIDToFilters(
  filters: Filters,
  relationID: LongID
): Filters {
  return {
    ...addAuthorFromIDToFilters(filters, relationID as ID),
    knowledgeListbyID: addIDToFilter(
      filters.knowledgeListbyID,
      relationID,
      "#d"
    ),
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

  // Also query for ALL relations with this node as HEAD (for diff items from other users)
  return {
    ...addRelationIDToFilters(filters, listID),
    knowledgeListByHead: addIDToFilter(
      filters.knowledgeListByHead,
      nodeID,
      "#k"
    ),
  };
}

export function addDescendantsToFilters(
  filters: Filters,
  nodeID: LongID | ID
): Filters {
  return {
    ...filters,
    knowledgeListByContext: addIDToFilter(
      filters.knowledgeListByContext,
      nodeID,
      "#c"
    ),
    knowledgeListByHead: addIDToFilter(
      filters.knowledgeListByHead,
      nodeID,
      "#k"
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
    knowledgeListbyID: {
      kinds: [KIND_KNOWLEDGE_LIST],
    },
    knowledgeNodesByID: {
      kinds: [KIND_KNOWLEDGE_NODE],
    },
    knowledgeListByHead: {
      kinds: [KIND_KNOWLEDGE_LIST],
    },
    knowledgeListByContext: {
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

  useEffect(() => {
    if (!eose || disabled) {
      return;
    }
    clearTimeout(setAllEventsProcessedTimeout.current);
    // eslint-disable-next-line functional/immutable-data
    setAllEventsProcessedTimeout.current = setTimeout(() => {
      setAllEventsProcessed(true);
    }, eventLoadingTimeout) as unknown as number;
  }, [
    events.size,
    eose,
    JSON.stringify(filters),
    disabled,
    eventLoadingTimeout,
  ]);

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
  const { user, contacts, projectMembers } = useData();
  const effectiveAuthor = useCurrentPane().author;

  const baseFilter = createBaseFilter(
    contacts,
    projectMembers,
    user.publicKey,
    effectiveAuthor
  );

  const filter = nodeIDs.reduce((acc, nodeID) => {
    const withNode = addNodeToFilters(acc, nodeID, lists);
    const withDescendants = descendants
      ? addDescendantsToFilters(withNode, nodeID)
      : withNode;
    const withReferencedBy = referencedBy
      ? addReferencedByToFilters(withDescendants, nodeID)
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
  const { user, contacts, projectMembers } = useData();
  const effectiveAuthor = useCurrentPane().author;
  const baseFilter = createBaseFilter(
    contacts,
    projectMembers,
    user.publicKey,
    effectiveAuthor
  );
  const filter = addRelationIDToFilters(baseFilter, relationID);
  const filterArray = filtersToFilterArray(filter);
  useQueryKnowledgeData(filterArray);
  return <>{children}</>;
}

export function LoadMissingVersionNodes({
  children,
  nodes,
}: {
  children: React.ReactNode;
  nodes?: List<ViewPath>;
}): JSX.Element {
  const data = useData();
  const [contextNodeID] = useNodeID();
  const contextViewPath = useViewPath();
  const stack = usePaneStack();

  const viewPaths = nodes ?? List([contextViewPath]);

  const missingVersionNodeIDs: ID[] = viewPaths.reduce<ID[]>(
    (acc, viewPath) => {
      const [nodeID] = nodes
        ? getNodeIDFromView(data, viewPath)
        : [contextNodeID];
      const context = getContext(data, viewPath, stack);
      const effectiveAuthor = getEffectiveAuthor(data, viewPath);
      const versionsRel = getVersionsRelations(
        data.knowledgeDBs,
        effectiveAuthor,
        nodeID,
        context
      );
      if (versionsRel) {
        const firstVersionID = versionsRel.items.first()?.nodeID;
        if (firstVersionID) {
          const firstVersionNode = getNodeFromID(
            data.knowledgeDBs,
            firstVersionID,
            effectiveAuthor
          );
          if (!firstVersionNode && !acc.includes(firstVersionID)) {
            return [...acc, firstVersionID];
          }
        }
      }
      return acc;
    },
    []
  );

  if (missingVersionNodeIDs.length > 0) {
    return <LoadData nodeIDs={missingVersionNodeIDs}>{children}</LoadData>;
  }

  return <>{children}</>;
}
