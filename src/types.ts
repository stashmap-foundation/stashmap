import { Map, OrderedMap, List, OrderedSet, Set } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { QueueStatus } from "./infra/nostr/cache/PublishQueue";
import { Document as DocumentType } from "./core/Document";

declare global {
  type Children = {
    children?: React.ReactNode;
  };

  type PublicKey = string & { readonly "": unique symbol };

  type FrontMatter = Record<string, unknown>;

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

  type DesktopShellBridge = {
    isElectron: boolean;
    platform?: string;
  };

  interface Window {
    nostr: Nostr;
    knowstrDesktop?: DesktopShellBridge;
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

  export type HasPublicKey = {
    publicKey: PublicKey;
  };

  type Contacts = Map<PublicKey, Contact>;

  type KnowledgeDBs = Map<PublicKey, KnowledgeData>;

  type SnapshotNodes = Map<string, Map<string, GraphNode>>;

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
        nodeID: ID;
        index: number;
        nodeItem: GraphNode;
        paneIndex: number;
      }
    | { type: "REMOVE_EMPTY_NODE"; nodeID: ID };

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
    author: PublicKey;
    sourceId: SourceId;
    documentId?: string;
    rootNodeId?: ID;
    searchQuery?: string;
    searchResultIDs?: ID[];
    typeFilters?: (
      | Relevance
      | "suggestions"
      | "versions"
      | "incoming"
      | "contains"
    )[];
    scrollToId?: string;
  };

  type Data = {
    contacts: Contacts;
    user: User;
    contactsRelays: Map<PublicKey, Relays>;
    knowledgeDBs: KnowledgeDBs;
    snapshotNodes: SnapshotNodes;
    graphIndex: GraphIndex;
    documents: Map<string, DocumentType>;
    documentByFilePath: Map<string, DocumentType>;
    relaysInfos: Map<string, RelayInformation | undefined>;
    publishEventsStatus: EventState;

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
  type SourceId = string;

  type NodeRef = {
    sourceId: SourceId;
    id: ID;
  };

  type Row = {
    viewPath: readonly [number, ...ID[]];
    viewKey: string;
    index: number;
    depth: number;
    node: GraphNode;
    sourceId: SourceId;
    ref: NodeRef;
    rowID: ID;
    view: View;
    parentViewPath: readonly [number, ...ID[]] | undefined;
    parentRef: NodeRef | undefined;
    parentNode: GraphNode | undefined;
    parentChildIndex: number | undefined;
    childIndex: number | undefined;
    hasChildren: boolean;
    isFirstVirtual: boolean;
    virtualType: "suggestion" | "search" | "incoming" | "version" | undefined;
    versionMeta:
      | {
          updated: number;
          addCount: number;
          removeCount: number;
        }
      | undefined;
    reference:
      | {
          id: ID;
          sourceId: SourceId;
          type: "reference";
          text: string;
          targetContext: List<ID>;
          contextLabels: string[];
          targetLabel: string;
          author: PublicKey;
          incomingRelevance?: Relevance;
          incomingArgument?: Argument;
          displayAs?: "bidirectional" | "incoming";
          versionMeta?: Row["versionMeta"];
          deleted?: boolean;
        }
      | undefined;
  };

  type View = {
    expanded?: boolean;
    typeFilters?: Array<
      Relevance | "suggestions" | "versions" | "incoming" | "contains"
    >;
  };

  // Context is the path of ancestor node IDs leading to the head node
  // e.g., [scholarium-id, places-id] when viewing via "Scholarium > Places > Node"
  type Context = List<ID>;

  // Relevance levels for node children
  // undefined = "contains" (no relevance set, default for new children)
  type Relevance =
    | "relevant"
    | "maybe_relevant"
    | "little_relevant"
    | "not_relevant"
    | undefined;

  // Argument types (evidence) for node children
  type Argument = "confirms" | "contra" | undefined;

  type RootSystemRole = "log";

  type InlineSpan =
    | { kind: "text"; text: string }
    | { kind: "link"; targetID: ID; text: string }
    | { kind: "fileLink"; path: string; text: string };

  type GraphNode = {
    children: List<ID>;
    id: ID;
    spans: InlineSpan[];
    docId?: string;
    parent?: ID;
    systemRole?: RootSystemRole;
    userPublicKey?: PublicKey;
    snapshotId?: string;
    updated: number;
    author: PublicKey;
    basedOn?: ID;
    root: ID;
    relevance: Relevance;
    argument?: Argument;
    blockKind?: "heading" | "list_item" | "paragraph";
    headingLevel?: number;
    listOrdered?: boolean;
    listStart?: number;
  };

  type Views = Map<string, View>;

  type NodeType = {
    color: string;
    label: string;
    invertedNodeLabel: string;
  };
  type NodeTypes = OrderedMap<ID, NodeType>;

  type KnowledgeData = {
    nodes: Map<ID, GraphNode>;
  };

  type GraphIndex = {
    nodeByID: globalThis.Map<ID, GraphNode>;
    nodesBySource: globalThis.Map<SourceId, globalThis.Map<ID, GraphNode>>;
    sourceCandidatesById: globalThis.Map<ID, NodeRef[]>;
    semantic: globalThis.Map<string, globalThis.Set<ID>>;
    semanticRefs: globalThis.Map<string, NodeRef[]>;
    incomingCrefs: globalThis.Map<ID, NodeRef[]>;
    incomingCrefsByTarget: globalThis.Map<string, NodeRef[]>;
    incomingFileLinks: globalThis.Map<string, NodeRef[]>;
    basedOnIndex: globalThis.Map<ID, globalThis.Set<ID>>;
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
