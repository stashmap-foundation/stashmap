import { Map } from "immutable";
import { useEventQuery } from "../shared/useNostrQuery";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";
import { useData } from "../../DataContext";
import { useApis } from "../app-shell/ApiContext";
import { KIND_SEARCH } from "../app-shell/Data";
import { findDocumentNodes } from "../../documentMaterialization";
import { buildTextNodesFromGraphNodes } from "../../graph/context";
import type { TextSeed } from "../../graph/types";
import { useReadRelays } from "../../relays";

function isMatch(input: string, test: string): boolean {
  const searchStr = input.toLowerCase().replace(/\n/g, "");
  const str = test.toLowerCase().replace(/\n/g, "");
  return str.indexOf(searchStr) !== -1;
}

export function filterForKeyword(
  nodes: Map<string, TextSeed>,
  filter: string
): Map<string, TextSeed> {
  return filter === ""
    ? Map<string, TextSeed>()
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
): [Map<string, TextSeed>, boolean] {
  const { relayPool } = useApis();
  const { contacts, user } = useData();
  const authors = contacts.keySeq().toSet().add(user.publicKey).toArray();
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
  const documentNodes = findDocumentNodes(eventsAsList).valueSeq();
  const textNodes = buildTextNodesFromGraphNodes(documentNodes);
  const nodesFromKnowledgeEvents = nip50
    ? textNodes.slice(0, 25)
    : filterForKeyword(textNodes, query);

  const isQueryFinished = eose;
  const isEose = isQueryFinished || relays.length === 0;
  return [nodesFromKnowledgeEvents, isEose];
}
