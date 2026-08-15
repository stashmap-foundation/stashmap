import { Map, OrderedMap, List, OrderedSet, Set } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
import { QueueStatus } from "./infra/nostr/cache/PublishQueue";
import { Document as DocumentType } from "./core/Document";
import { IcalEntry } from "./core/ical";
import type { AddToParentTarget } from "./core/plan";
import type { ComposedRow, CompositionResult } from "./core/composition";

declare global {
  type Children = {
    children?: React.ReactNode;
  };

  type PublicKey = string & { readonly "": unique symbol };

  type FrontMatter = Record<string, unknown>;

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

  type PublicationRoute =
    | { kind: "configuration"; relays: string[] }
    | { kind: "storage" }
    | { kind: "shared" };

  type EventAttachment = {
    route: PublicationRoute;
    storageKey?: string;
  };

  type TemporaryEvent =
    | {
        type: "ADD_EMPTY_NODE";
        parentKey: string;
        index: number;
        nodeItem: GraphNode;
        paneIndex: number;
      }
    | { type: "REMOVE_EMPTY_NODE"; parentKey: string };

  type EventState = PublishEvents<EventAttachment> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    queueStatus?: QueueStatus;
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
    coordinatesBySourceId: ReadonlyMap<SourceId, RouteCoordinate>;
  };

  type Data = {
    user: User | undefined;
    knowledgeDBs: KnowledgeDBs;
    graphIndex: GraphIndex;
    documents: Map<string, DocumentType>;
    documentByFilePath: Map<string, DocumentType>;
    publishEventsStatus: EventState;
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
    view: View;
    parentViewPath: readonly [number, ...ID[]] | undefined;
    parentKey: string | undefined;
    hasChildren: boolean;
    isFirstVirtual: boolean;
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
  } & (
    | {
        rowType: "occurrence";
        occurrence: ComposedRow;
        composition: CompositionResult;
        incomingTarget: undefined;
        incomingParent: undefined;
        incomingEmbed: undefined;
        emptyParent: undefined;
        virtualType: undefined;
        action: undefined;
      }
    | ({
        node: GraphNode;
        sourceId: SourceId;
        ref: NodeRef;
        parentRef: NodeRef | undefined;
        parentNode: GraphNode | undefined;
        parentChildIndex: number | undefined;
        childIndex: number | undefined;
      } & (
        | {
            rowType: "incoming";
            occurrence: undefined;
            composition: CompositionResult | undefined;
            incomingTarget: AddToParentTarget;
            incomingParent: ComposedRow | undefined;
            incomingEmbed: true | undefined;
            emptyParent: undefined;
            virtualType: "incoming";
            action: undefined;
          }
        | {
            rowType: "search";
            occurrence: undefined;
            composition: undefined;
            incomingTarget: undefined;
            incomingParent: undefined;
            incomingEmbed: undefined;
            emptyParent: undefined;
            virtualType: "search";
            action: undefined;
          }
        | {
            rowType: "empty";
            occurrence: undefined;
            composition: CompositionResult | undefined;
            incomingTarget: undefined;
            incomingParent: undefined;
            incomingEmbed: undefined;
            emptyParent: ComposedRow | undefined;
            virtualType: undefined;
            action: undefined;
          }
        | {
            rowType: "action";
            occurrence: undefined;
            composition: undefined;
            incomingTarget: undefined;
            incomingParent: undefined;
            incomingEmbed: undefined;
            emptyParent: undefined;
            virtualType: undefined;
            action: "toggle-past-entries";
          }
      ))
  );

  type View = {
    expanded?: boolean;
    showPastEntries?: boolean;
    typeFilters?: Array<Relevance | "incoming" | "contains">;
  };

  type Context = List<ID>;

  type Relevance =
    | "relevant"
    | "maybe_relevant"
    | "little_relevant"
    | "not_relevant"
    | undefined;

  type Argument = "confirms" | "contra" | undefined;

  type RootSystemRole = "log";

  type InlineSpan =
    | { kind: "text"; text: string }
    | { kind: "link"; href: string; text: string; struck?: true };

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
