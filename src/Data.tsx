import React, { useEffect, useState } from "react";
import "./App.css";
import { List, Map, Set, OrderedSet } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import {
  KIND_KNOWLEDGE_NODE,
  KIND_CONTACTLIST,
  KIND_VIEWS,
  KIND_SETTINGS,
  KIND_MEMBERLIST,
  KIND_RELAY_METADATA_EVENT,
} from "./nostr";
import { DataContextProvider } from "./DataContext";
import { findContacts, findMembers } from "./contacts";
import { useApis } from "./Apis";
import { findNodes, findRelations, findViews } from "./knowledgeEvents";
import { DEFAULT_SETTINGS, findSettings } from "./settings";
import { newDB } from "./knowledge";
import { PlanningContextProvider } from "./planner";
import { useUserRelayContext } from "./UserRelayContext";
import { WorkspaceContextProvider } from "./WorkspaceContext";
import { NavigationStackProvider } from "./NavigationStackContext";
import { flattenRelays, usePreloadRelays, findRelays } from "./relays";
import { sortEventsDescending, useEventQuery } from "./commons/useNostrQuery";

type DataProps = {
  user: User;
  children: React.ReactNode;
};

type ProcessedEvents = {
  settings: Settings;
  knowledgeDB: KnowledgeData;
  contacts: Contacts;
  relays: Relays;

  views: Views;
  projectMembers: Members;
};

export function newProcessedEvents(): ProcessedEvents {
  return {
    settings: DEFAULT_SETTINGS,
    knowledgeDB: newDB(),
    contacts: Map<PublicKey, Contact>(),
    relays: [],
    views: Map<string, View>(),
    projectMembers: Map<PublicKey, Member>(),
  };
}

export const KIND_SEARCH = [KIND_KNOWLEDGE_NODE];

export const KINDS_META = [KIND_SETTINGS, KIND_CONTACTLIST, KIND_VIEWS];

function mergeEvents(
  processed: ProcessedEvents,
  events: List<UnsignedEvent | Event>
): ProcessedEvents {
  return {
    ...processed,
    contacts: processed.contacts.merge(findContacts(events)),
    views: findViews(events).merge(processed.views),
  };
}

function processEventsByAuthor(
  authorEvents: List<UnsignedEvent | Event>
): ProcessedEvents {
  const settings = findSettings(authorEvents);
  const contacts = findContacts(authorEvents);
  const nodes = findNodes(authorEvents);
  const relations = findRelations(authorEvents);
  const views = findViews(authorEvents);
  const projectMembers = findMembers(authorEvents);
  const knowledgeDB = {
    nodes,
    relations,
  };
  const relays = findRelays(authorEvents);
  return {
    settings,
    contacts,
    knowledgeDB,
    relays,
    views,
    projectMembers,
  };
}

export function processEvents(
  events: List<UnsignedEvent>
): Map<PublicKey, ProcessedEvents> {
  const groupedByAuthor = events.groupBy((e) => e.pubkey as PublicKey);
  const sorted = groupedByAuthor.map((authorEvents) =>
    sortEventsDescending(List(authorEvents.valueSeq()))
  );
  return Map<PublicKey, ProcessedEvents>(
    sorted.toArray().map(([author, authorEvents]) => {
      return [author, processEventsByAuthor(authorEvents)];
    })
  );
}

export function useRelaysInfo(
  relays: Array<Relay>,
  eose: boolean
): Map<string, RelayInformation | undefined> {
  const { nip11 } = useApis();
  const [infos, setInfos] = useState<Map<string, RelayInformation | undefined>>(
    Map<string, RelayInformation | undefined>()
  );
  useEffect(() => {
    if (!eose) {
      return;
    }

    (async () => {
      const fetchedInfos = await Promise.all(
        relays.map(
          async (relay): Promise<[string, RelayInformation | undefined]> => {
            try {
              const info = await nip11.fetchRelayInformation(relay.url);
              return [relay.url, info];
            } catch {
              return [relay.url, undefined];
            }
          }
        )
      );
      setInfos(Map(fetchedInfos));
    })();
  }, [JSON.stringify(relays.map((r) => r.url)), eose]);
  return infos;
}

const DEFAULT_TEMPORARY_VIEW: TemporaryViewState = {
  selection: OrderedSet<string>(),
  multiselectBtns: Set<string>(),
  editingViews: Set<string>(),
  editorOpenViews: Set<string>(),
  createNodeEditorState: null,
};

function Data({ user, children }: DataProps): JSX.Element {
  const myPublicKey = user.publicKey;
  const [newEventsAndPublishResults, setNewEventsAndPublishResults] =
    useState<EventState>({
      unsignedEvents: List(),
      results: Map(),
      isLoading: false,
      preLoginEvents: List(),
      temporaryView: DEFAULT_TEMPORARY_VIEW,
    });
  const { isRelaysLoaded } = useUserRelayContext();
  const { relayPool } = useApis();

  const { events: mE, eose: metaEventsEose } = useEventQuery(
    relayPool,
    [
      {
        authors: [myPublicKey],
        kinds: [KIND_SETTINGS, KIND_CONTACTLIST, KIND_VIEWS],
      },
    ],
    {
      readFromRelays: usePreloadRelays({
        user: true,
      }),
    }
  );
  const metaEvents = mE
    .valueSeq()
    .toList()
    .merge(newEventsAndPublishResults.unsignedEvents);

  const processedMetaEvents = mergeEvents(
    processEvents(metaEvents).get(myPublicKey, newProcessedEvents()),
    newEventsAndPublishResults.preLoginEvents
  );
  const contacts = processedMetaEvents.contacts.filter(
    (_, k) => k !== myPublicKey
  );

  const { events: contactRelayEvents } = useEventQuery(
    relayPool,
    [
      {
        authors: contacts.keySeq().toArray(),
        kinds: [KIND_RELAY_METADATA_EVENT],
      },
    ],
    {
      readFromRelays: usePreloadRelays({
        defaultRelays: true,
        user: true,
      }),
      enabled: metaEventsEose,
    }
  );

  const processedContactRelayEvents = processEvents(
    contactRelayEvents.valueSeq().toList()
  );

  const contactsRelays = processedContactRelayEvents.reduce((rdx, p, key) => {
    return rdx.set(key, p.relays);
  }, Map<PublicKey, Relays>());
  const searchRelaysInfo = useRelaysInfo(
    [
      ...usePreloadRelays({
        defaultRelays: false,
        user: true,
      }),
      ...flattenRelays(contactsRelays),
    ],
    isRelaysLoaded
  );

  const projectMembers = Map<PublicKey, Member>();

  return (
    <DataContextProvider
      contacts={contacts}
      user={user}
      settings={processedMetaEvents.settings}
      contactsRelays={contactsRelays}
      knowledgeDBs={Map<PublicKey, KnowledgeData>()}
      relaysInfos={searchRelaysInfo}
      publishEventsStatus={newEventsAndPublishResults}
      views={processedMetaEvents.views}
      projectMembers={projectMembers}
    >
      <WorkspaceContextProvider>
        <NavigationStackProvider>
          <PlanningContextProvider
            setPublishEvents={setNewEventsAndPublishResults}
          >
            {children}
          </PlanningContextProvider>
        </NavigationStackProvider>
      </WorkspaceContextProvider>
    </DataContextProvider>
  );
}
export default Data;
