import { Map, OrderedMap, List, OrderedSet, Set } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { QueueStatus } from "./infra/nostr/cache/PublishQueue";
import { Document as DocumentType } from "./core/Document";
import { IcalEntry } from "./core/ical";
import type { AddToParentTarget } from "./core/plan";

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

  type Relays = Array<Relay>;

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
    // NIP-07 optional capability, required by knowstr: storage encryption
    // wraps per-document keys via nip44 self-encryption.
    nip44: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
    };
  };

  type DesktopShellBridge = {
    isElectron: boolean;
    platform?: string;
    fetchText?: (url: string) => Promise<string>;
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

  export type HasPublicKey = {
    publicKey: PublicKey;
  };

  type KnowledgeDBs = Map<SourceId, KnowledgeData>;

  type LocationState = {
    referrer?: string;
  };

  type WriteRelayConf = {
    defaultRelays?: boolean;
    user?: boolean;
    extraRelays?: Relays;
  };

  type EventAttachment = {
    writeRelayConf?: WriteRelayConf;
    // Per-document storage encryption key, carried alongside the event while
    // it travels inside the app (plaintext internally). The publish seam
    // encrypts the content with it and never signs it into the wire event.
    storageKey?: string;
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
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    queueStatus?: QueueStatus;
  };

  type AllRelays = {
    defaultRelays: Relays;
    userRelays: Relays;
  };

  type RouteCoordinate = {
    eventKind: 34774 | 34775;
    pubkey: PublicKey;
    dTag: string;
    relays: string[];
  };

  type PaneSource =
    | { kind: "local" }
    | { kind: "storage"; coordinate: RouteCoordinate; storageKey: string }
    | { kind: "deposit"; coordinate: RouteCoordinate };

  type PaneTarget =
    | { kind: "home" }
    | { kind: "node"; nodeId: ID; label?: string }
    | { kind: "document"; docId: string }
    | { kind: "source-document" }
    | { kind: "search"; query: string; resultIds: ID[] };

  type Pane = {
    id: string;
    sourceId: SourceId;
    routeCoordinate?: RouteCoordinate;
    documentId?: string;
    rootNodeId?: ID;
    // Capability from a share link (#key= fragment): the storage key that
    // opens the pane's encrypted foreign document.
    storageKey?: string;
    fallbackLabel?: string;
    searchQuery?: string;
    searchResultIDs?: ID[];
    typeFilters?: (Relevance | "incoming" | "contains")[];
    scrollToId?: string;
  };

  type PullOverlayData = {
    matchedSourceIdsByPaneId: ReadonlyMap<string, readonly SourceId[]>;
  };

  type Data = {
    user: User | undefined;
    knowledgeDBs: KnowledgeDBs;
    graphIndex: GraphIndex;
    documents: Map<string, DocumentType>;
    documentByFilePath: Map<string, DocumentType>;
    relaysInfos: Map<string, RelayInformation | undefined>;
    publishEventsStatus: EventState;
    // Fetched calendar feeds, keyed by feed URL — the read path of the
    // machine-feeds law. Projections derive from these at row-build time
    // and never enter knowledgeDBs.
    calendarFeeds?: Map<string, IcalEntry[]>;
    pull?: PullOverlayData;

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
    view: View;
    parentViewPath: readonly [number, ...ID[]] | undefined;
    parentRef: NodeRef | undefined;
    parentNode: GraphNode | undefined;
    parentChildIndex: number | undefined;
    childIndex: number | undefined;
    hasChildren: boolean;
    provenance?: {
      kind: "incoming";
      sourceId: SourceId;
    };
    // The materialization recipe (idea.md: write gestures take first).
    // Plain data attached by the row's producer: nearest-first anchors,
    // optionally a prepared take (references enter as references) and
    // judgment defaults inherited from the proposal's source. Present =
    // the row is computed and a write gesture must materialize it first.
    materialize?: {
      precededBy: ID[];
      take?: AddToParentTarget;
      defaults?: { relevance?: Relevance; argument?: Argument };
      host?: Pick<Row, "node" | "parentRef" | "materialize">;
      root?: true;
    };
    standsFor?: { id: ID; liveText?: string };
    isFirstVirtual: boolean;
    virtualType: "search" | "incoming" | undefined;
    // The action row: a button in row position, obviously not content.
    // One interaction (click); no gutter, no editor, no judgment, no drag.
    action?: "toggle-past-entries";
    reference:
      | {
          id: ID;
          sourceId: SourceId;
          text: string;
          contextLabels: string[];
          targetLabel: string;
          incomingRelevance?: Relevance;
          incomingArgument?: Argument;
          displayAs?: "incoming";
        }
      | undefined;
  };

  type View = {
    expanded?: boolean;
    // Calendar feed nodes: project bare past entries too (default: only
    // upcoming entries project; file content always shows).
    showPastEntries?: boolean;
    typeFilters?: Array<Relevance | "incoming" | "contains">;
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
    | { kind: "link"; href: string; text: string };

  type GraphNode = {
    children: List<ID>;
    id: ID;
    spans: InlineSpan[];
    docId?: string;
    parent?: ID;
    systemRole?: RootSystemRole;
    updated: number;
    root: ID;
    relevance: Relevance;
    argument?: Argument;
    blockKind?: "heading" | "list_item" | "paragraph";
    headingLevel?: number;
    listOrdered?: boolean;
    listStart?: number;
    extraAttrs?: Record<string, string>;
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
    incomingCrefs: globalThis.Map<ID, NodeRef[]>;
    incomingCrefsByTarget: globalThis.Map<string, NodeRef[]>;
    incomingFileLinks: globalThis.Map<string, NodeRef[]>;
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
