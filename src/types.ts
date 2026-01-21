import { Map, OrderedMap, List, OrderedSet, Set } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";

declare global {
  type Children = {
    children?: React.ReactNode;
  };

  type PublicKey = string & { readonly "": unique symbol };

  type Relay = {
    url: string;
    read: boolean;
    write: boolean;
  };

  type SuggestedRelay = Relay & {
    numberOfContacts: number;
  };

  type Relays = Array<Relay>;

  type SuggestedRelays = Array<SuggestedRelay>;

  type NotificationMessage = {
    title: string;
    message: string;
    date?: Date;
    navigateToLink?: string;
  };

  type PublishStatus = {
    status: "rejected" | "fulfilled";
    reason?: string;
  };
  type PublishResultsOfEvent = {
    event: Event;
    results: Map<string, PublishStatus>;
  };
  type PublishResultsEventMap = Map<string, PublishResultsOfEvent>;

  type PublishEvents<T = void> = {
    unsignedEvents: List<UnsignedEvent & T>;
    results: PublishResultsEventMap;
    isLoading: boolean;
  };

  type PublishResultsOfRelay = Map<string, Event & PublishStatus>;
  type PublishResultsRelayMap = Map<string, PublishResultsOfRelay>;
  type RepublishEvents = (
    events: List<Event>,
    relayUrl: string
  ) => Promise<void>;

  export type Nostr = {
    getPublicKey: () => Promise<PublicKey>;
    signEvent: (event: EventTemplate) => Promise<Event>;
  };

  interface Window {
    nostr: Nostr;
  }

  export type KeyPair = {
    privateKey: Uint8Array;
    publicKey: PublicKey;
  };

  export type User =
    | KeyPair
    | {
        publicKey: PublicKey;
      };

  export type Contact = {
    publicKey: PublicKey;
    mainRelay?: string;
    userName?: string;
  };

  export type Member = Contact & {
    votes: number;
  };

  export type HasPublicKey = {
    publicKey: PublicKey;
  };

  type Contacts = Map<PublicKey, Contact>;
  type Members = Map<PublicKey, Member>;

  type KnowledgeDBs = Map<PublicKey, KnowledgeData>;

  type LocationState = {
    referrer?: string;
  };

  type WriteRelayConf = {
    defaultRelays?: boolean;
    user?: boolean;
    contacts?: boolean;
    extraRelays?: Relays;
  };

  type EventAttachment = {
    writeRelayConf?: WriteRelayConf;
  };

  type TemporaryEvent =
    | { type: "ADD_EMPTY_NODE"; relationsID: LongID; index: number; relationItem: RelationItem }
    | { type: "REMOVE_EMPTY_NODE"; relationsID: LongID };

  type EventState = PublishEvents<EventAttachment> & {
    preLoginEvents: List<UnsignedEvent & EventAttachment>;
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

  type AllRelays = {
    defaultRelays: Relays;
    userRelays: Relays;
    contactsRelays: Relays;
  };

  type Data = {
    contacts: Contacts;
    user: User;
    contactsRelays: Map<PublicKey, Relays>;
    knowledgeDBs: KnowledgeDBs;
    relaysInfos: Map<string, RelayInformation | undefined>;
    publishEventsStatus: EventState;
    projectMembers: Members;

    views: Views;
  };

  type LocalStorage = {
    setLocalStorage: (key: string, value: string) => void;
    getLocalStorage: (key: string) => string | null;
    deleteLocalStorage: (key: string) => void;
  };

  type CompressedSettings = {
    v: string;
    n: Buffer;
  };

  type CompressedSettingsFromStore = {
    v: string;
    n: string;
  };

  type Hash = string;
  type ID = string;
  type LongID = string & { readonly "": unique symbol };

  type View = {
    virtualLists?: Array<LongID>;
    relations?: LongID;
    width: number;
    // Show children, only relevant for inner nodes
    expanded?: boolean;
    // Type filters for children view (empty/undefined = defaults: relevant, maybe_relevant, confirms, contra, suggestions)
    typeFilters?: Array<Relevance | Argument | "suggestions">;
  };

  // Context is the path of ancestor node IDs leading to the head node
  // e.g., [scholarium-id, places-id] when viewing via "Scholarium > Places > Node"
  type Context = List<ID>;

  // Relevance levels for relation items
  type Relevance = "relevant" | "" | "little_relevant" | "not_relevant";

  // Argument types (evidence) for relation items
  type Argument = "confirms" | "contra" | undefined;

  // Each item in a relation has relevance and optional argument
  type RelationItem = {
    nodeID: LongID | ID;
    relevance: Relevance; // "" = maybe relevant (default), "relevant", "little_relevant", "not_relevant"
    argument?: Argument; // "confirms", "contra", or undefined (neutral)
  };

  type Relations = {
    items: List<RelationItem>;
    head: ID;
    context: Context;
    id: LongID;
    updated: number;
    author: PublicKey;
  };

  type BasicNode = {
    id: ID;
    text: string;
    type: "text" | "reference";
  };

  type TextNode = BasicNode & {
    type: "text";
  };

  // A virtual node representing a path to another node
  // ID format: "ref:targetId:context0:context1:..."
  // Not stored on server - reconstructed from ID
  type ReferenceNode = {
    id: LongID;
    type: "reference";
    text: string; // Computed: "My Notes → Scholarium → Madeira"
    targetNode: ID; // The node being referenced
    targetContext: Context; // The path to reach it
  };

  type KnowNode = TextNode | ReferenceNode;

  type Views = Map<string, View>;

  type Nodes = Map<ID, KnowNode>;

  type RelationType = {
    color: string;
    label: string;
    invertedRelationLabel: string;
  };
  type RelationTypes = OrderedMap<ID, RelationType>;

  type KnowledgeData = {
    nodes: Map<ID, KnowNode>;
    relations: Map<ID, Relations>;
  };

  // Temporary UI state (not persisted to Nostr)
  type TemporaryViewState = {
    // Multiselect
    selection: OrderedSet<string>;
    multiselectBtns: Set<string>;
    // Editing state
    editingViews: Set<string>;
    // AddToNode editor open state
    editorOpenViews: Set<string>;
    // Draft texts: draftID → current text being typed
    draftTexts: Map<string, string>;
  };
}

export const ROOT: LongID = "ROOT" as LongID;
