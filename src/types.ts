import { Map, OrderedMap, List, OrderedSet, Set } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { QueueStatus } from "./PublishQueue";

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
    | {
        type: "ADD_EMPTY_NODE";
        relationsID: LongID;
        index: number;
        relationItem: RelationItem;
        paneIndex: number;
      }
    | { type: "REMOVE_EMPTY_NODE"; relationsID: LongID };

  type EventState = PublishEvents<EventAttachment> & {
    preLoginEvents: List<UnsignedEvent & EventAttachment>;
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    queueStatus?: QueueStatus;
  };

  type AllRelays = {
    defaultRelays: Relays;
    userRelays: Relays;
    contactsRelays: Relays;
  };

  type Pane = {
    id: string;
    stack: ID[];
    author: PublicKey;
    rootRelation?: LongID;
    searchQuery?: string;
    typeFilters?: (
      | Relevance
      | Argument
      | "suggestions"
      | "versions"
      | "incoming"
      | "occurrence"
      | "contains"
    )[];
    scrollToNodeId?: string;
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
    panes: Pane[];
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
    expanded?: boolean;
    typeFilters?: Array<
      | Relevance
      | Argument
      | "suggestions"
      | "versions"
      | "incoming"
      | "occurrence"
      | "contains"
    >;
  };

  // Context is the path of ancestor node IDs leading to the head node
  // e.g., [scholarium-id, places-id] when viewing via "Scholarium > Places > Node"
  type Context = List<ID>;

  // Relevance levels for relation items
  // undefined = "contains" (no relevance set, default for new items)
  type Relevance =
    | "relevant"
    | "maybe_relevant"
    | "little_relevant"
    | "not_relevant"
    | undefined;

  // Argument types (evidence) for relation items
  type Argument = "confirms" | "contra" | undefined;

  // Each item in a relation has relevance and optional argument
  type VirtualType =
    | "suggestion"
    | "search"
    | "incoming"
    | "occurrence"
    | "version";

  type VersionMeta = {
    updated: number;
    addCount: number;
    removeCount: number;
  };

  type RelationItem = {
    nodeID: LongID | ID;
    relevance: Relevance; // undefined = contains (default), "relevant", "maybe_relevant", "little_relevant", "not_relevant"
    argument?: Argument; // "confirms", "contra", or undefined (neutral)
    virtualType?: VirtualType;
    isCref?: boolean;
  };

  type Relations = {
    items: List<RelationItem>;
    head: ID;
    context: Context;
    id: LongID;
    updated: number;
    author: PublicKey;
    basedOn?: LongID;
    root: ID;
  };

  type BasicNode = {
    id: ID;
    text: string;
    type: "text" | "reference";
  };

  type TextNode = BasicNode & {
    type: "text";
  };

  type ReferenceNode = {
    id: LongID;
    type: "reference";
    text: string;
    targetNode: ID;
    targetContext: Context;
    contextLabels: string[];
    targetLabel: string;
    author: PublicKey;
    incomingRelevance?: Relevance;
    incomingArgument?: Argument;
    displayAs?: "bidirectional" | "incoming" | "occurrence";
    versionMeta?: VersionMeta;
    deleted?: boolean;
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

  type Tombstone = { head: ID; context: List<ID> };

  type KnowledgeData = {
    nodes: Map<ID, KnowNode>;
    relations: Map<ID, Relations>;
    tombstones?: Map<ID, Tombstone>;
  };

  // Temporary UI state (not persisted to Nostr)
  type TemporaryViewState = {
    // Per-pane row focus target for deterministic keyboard focus restoration
    rowFocusIntents: Map<number, RowFocusIntent>;
    // Multiselect
    baseSelection: OrderedSet<string>;
    shiftSelection: OrderedSet<string>;
    anchor: string;
    // Editing state
    editingViews: Set<string>;
    // AddToNode editor open state
    editorOpenViews: Set<string>;
    // Draft texts: draftID → current text being typed
    draftTexts: Map<string, string>;
  };

  type RowFocusIntent = {
    requestId: number;
    paneIndex: number;
    viewKey?: string;
    nodeId?: string;
    rowIndex?: number;
  };
}
