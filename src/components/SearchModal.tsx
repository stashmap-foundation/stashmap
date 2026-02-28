import { Map } from "immutable";
import { useEventQuery } from "../commons/useNostrQuery";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { useData } from "../DataContext";
import { useApis } from "../Apis";
import { KIND_SEARCH } from "../Data";
import { findDocumentNodesAndRelations } from "../knowledgeEvents";
import { useReadRelays } from "../relays";

function isMatch(input: string, test: string): boolean {
  const searchStr = input.toLowerCase().replace(/\n/g, "");
  const str = test.toLowerCase().replace(/\n/g, "");
  return str.indexOf(searchStr) !== -1;
}

export function filterForKeyword(
  nodes: Map<string, KnowNode>,
  filter: string
): Map<string, KnowNode> {
  return filter === ""
    ? Map<string, KnowNode>()
    : nodes
        .filter((node) => {
          return isMatch(filter, node.text);
        })
        .slice(0, 25);
}

export function useSearchQuery(
  query: string,
  relays: Relays,
  nip50: boolean
): [Map<string, KnowNode>, boolean] {
  const { relayPool } = useApis();
  const { contacts, user, projectMembers } = useData();
  const authors = contacts
    .keySeq()
    .toSet()
    .merge(projectMembers.keySeq().toSet())
    .add(user.publicKey)
    .toArray();
  const enabled = query !== "" && relays.length > 0;

  const basicFilter = {
    authors,
    kinds: KIND_SEARCH,
    limit: 3000,
  };

  const filter = nip50
    ? {
        ...basicFilter,
        search: query,
      }
    : basicFilter;

  const searchFilters = [
    filter,
    {
      authors,
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
    },
  ];

  const { events: preFilteredEvents, eose } = useEventQuery(
    relayPool,
    searchFilters,
    {
      enabled,
      readFromRelays: useReadRelays({
        user: true,
        contacts: true,
      }),
      discardOld: true,
    }
  );

  const events = nip50
    ? preFilteredEvents
    : preFilteredEvents.filter(
        (event) => event.kind === KIND_DELETE || isMatch(query, event.content)
      );

  const eventsAsList = events.toList();
  const nodesFromDocumentEvents =
    findDocumentNodesAndRelations(eventsAsList).nodes;
  const nodesFromKnowledgeEvents = nip50
    ? nodesFromDocumentEvents.slice(0, 25)
    : filterForKeyword(nodesFromDocumentEvents, query);

  const isQueryFinished = eose;
  const isEose = isQueryFinished || relays.length === 0;
  return [nodesFromKnowledgeEvents, isEose];
}
