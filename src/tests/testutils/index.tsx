import React from "react";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { List, Map, Set, OrderedSet } from "immutable";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
  MatcherFunction,
  RenderResult,
} from "@testing-library/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  Event,
  EventTemplate,
  Filter,
  UnsignedEvent,
  VerifiedEvent,
  getPublicKey,
  matchFilter,
  serializeEvent,
  verifiedSymbol,
} from "nostr-tools";
import userEvent from "@testing-library/user-event";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1";
import { VirtuosoMockContext } from "react-virtuoso";
import {
  KIND_CONTACTLIST,
  KIND_RELAY_METADATA_EVENT,
  KIND_SETTINGS,
} from "../../infra/nostrCore";
import { UNAUTHENTICATED_USER_PK } from "../../surface/app-shell/RequireLogin";
import { EMPTY_SEMANTIC_ID } from "../../graph/types";
import { splitID } from "../../graph/context";
import { createPlan } from "../../usecases/session/actions";
import { replaceUnauthenticatedUser } from "../../usecases/core/actions";
import { planUpsertContact, planRemoveContact } from "../../graph/commands";
import { PlanningContextProvider } from "../../surface/app-shell/PlannerContext";
import { execute } from "../../infra/nostr";
import {
  ApiProvider,
  Apis,
  FinalizeEvent,
} from "../../surface/app-shell/ApiContext";
import {
  DataContextProps,
  DataContextProvider,
  MergeKnowledgeDB,
} from "../../surface/app-shell/DataContext";
import type { LocalStorage } from "../../surface/app-shell/types";
import { GraphProvider } from "../../surface/app-shell/GraphProvider";
import { useEventQuery } from "../../surface/shared/useNostrQuery";
import { MockRelayPool, mockRelayPool } from "./nostrMock";
import {
  NostrAuthContextProvider,
  isUserLoggedInWithSeed,
  useUserOrAnon,
} from "../../surface/app-shell/NostrAuthContext";
import { RootViewContextProvider } from "../../surface/workspace/tree/RowContext";
import { LoadSearchData } from "../../surface/workspace/search/LoadSearchData";
import { StorePreLoginContext } from "../../surface/app-shell/StorePreLoginContext";
import { TemporaryViewProvider } from "../../surface/workspace/tree/TemporaryViewContext";
import { PaneView } from "../../surface/workspace/pane/PaneView";
import { DND } from "../../surface/workspace/tree/DND";
import {
  computeDepthLimits,
  setDropIndentDepth,
} from "../../surface/workspace/tree/DroppableContainer";
import { findContacts } from "../../infra/contacts";
import { UserRelayContextProvider } from "../../surface/app-shell/UserRelayContext";
import { StashmapDB } from "../../infra/indexedDB";
import type {
  AllRelays,
  PublishResultsOfEvent,
  Relays,
} from "../../infra/publishTypes";
import { createEmptySemanticIndex } from "../../graph/semanticIndex";
import type { KnowledgeData } from "../../graph/types";
import {
  createInMemoryBrowserDocumentRepository,
  createInMemoryBrowserDocumentRepositoryState,
} from "./inMemoryBrowserDocumentRepository";
import {
  mergeEvents,
  newProcessedEvents,
  processEvents,
} from "../../infra/eventProcessing";
import {
  getInitialPanes,
  loadPanesFromStorage,
  loadViewsFromStorage,
  savePanesToStorage,
  saveViewsToStorage,
} from "../../session/storage";

import {
  PaneIndexProvider,
  useCurrentPane,
  usePaneIndex,
} from "../../surface/workspace/layout/SplitPanesContext";
import { NavigationStateProvider } from "../../surface/workspace/layout/NavigationStateContext";
import AppShell from "../../surface/app-shell/AppShell";
import { RelaysWrapper } from "../../surface/app-shell/Relays";
import { SignInModal } from "../../surface/app-shell/SignIn";
import { SignUp } from "../../surface/app-shell/SignUp";
import { useRelaysInfo } from "../../surface/app-shell/useRelaysInfo";
import { flattenRelays } from "../../infra/relayUtils";
import type { Pane, RowFocusIntent, View, Views } from "../../session/types";

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});

export const ALICE_PRIVATE_KEY =
  "04d22f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";

const BOB_PRIVATE_KEY =
  "00000f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";

export const BOB_PUBLIC_KEY =
  "71a20276981b2a5019f634adfe10accd7e188f3eb5f57079da52de40b742a923" as PublicKey;

const CAROL_PRIVATE_KEY =
  "10000f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";
export const CAROL_PUBLIC_KEY =
  "074eb94a7a3d34102b563b540ac505e4fa8f71e3091f1e39a77d32e813c707d2" as PublicKey;

const UNAUTHENTICATED_ALICE: Contact = {
  publicKey:
    "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758" as PublicKey,
};

export const ANON: User = {
  publicKey: UNAUTHENTICATED_USER_PK,
};

const ALICE: User = {
  publicKey: UNAUTHENTICATED_ALICE.publicKey,
  privateKey: hexToBytes(ALICE_PRIVATE_KEY),
};

export const BOB: KeyPair = {
  publicKey: BOB_PUBLIC_KEY,
  privateKey: hexToBytes(BOB_PRIVATE_KEY),
};

export const CAROL: User = {
  publicKey: CAROL_PUBLIC_KEY,
  privateKey: hexToBytes(CAROL_PRIVATE_KEY),
};

const DEFAULT_TEST_PANES: Pane[] = [
  { id: "pane-0", stack: [], author: ALICE.publicKey },
];

export const TEST_RELAYS = [
  { url: "wss://relay.test.first.success/", read: true, write: true },
  { url: "wss://relay.test.second.fail/", read: true, write: true },
  { url: "wss://relay.test.third.rand/", read: true, write: true },
  { url: "wss://relay.test.fourth.success/", read: true, write: true },
];

type MockFileStore = LocalStorage & {
  getLocalStorageData: () => Map<string, string>;
};

type TestStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const TEST_REPOSITORY_STATES = new WeakMap<
  MockFileStore,
  ReturnType<typeof createInMemoryBrowserDocumentRepositoryState>
>();

function mockFileStore(): MockFileStore {
  const localStorage = jest.fn().mockReturnValue(Map());
  return {
    setLocalStorage: (key: string, value: string) => {
      const updatedLocalStorage = localStorage().set(key, value);
      localStorage.mockReturnValue(updatedLocalStorage);
    },
    getLocalStorage: (key: string): string | null => {
      return localStorage().get(key, null);
    },
    deleteLocalStorage: (key: string) => {
      const updatedLocalStorage = localStorage().delete(key);
      localStorage.mockReturnValue(updatedLocalStorage);
    },
    getLocalStorageData: (): Map<string, string> => localStorage(),
  };
}

function createStorageAdapter(fileStore: MockFileStore): TestStorage {
  return {
    getItem: (key) => fileStore.getLocalStorage(key),
    setItem: (key, value) => {
      fileStore.setLocalStorage(key, value);
    },
  };
}

function hasCustomPanes(panes: Pane[] | undefined): panes is Pane[] {
  if (!panes) {
    return false;
  }
  return JSON.stringify(panes) !== JSON.stringify(DEFAULT_TEST_PANES);
}

function hasCustomViews(views: Views | undefined): views is Views {
  if (!views) {
    return false;
  }
  return views.size > 0;
}

function finalizeEventWithoutWasm(
  t: EventTemplate,
  secretKey: Uint8Array
): VerifiedEvent {
  const pubkey = getPublicKey(secretKey);
  const eventHash = sha256(
    new Uint8Array(Buffer.from(serializeEvent({ ...t, pubkey }), "utf8"))
  );
  const id = bytesToHex(eventHash);
  const sig = bytesToHex(schnorr.sign(eventHash, secretKey));
  return {
    ...t,
    id,
    sig,
    pubkey,
    [verifiedSymbol]: true,
  };
}

export function mockFinalizeEvent(): FinalizeEvent {
  return (t: EventTemplate, secretKey: Uint8Array): VerifiedEvent =>
    finalizeEventWithoutWasm(t, secretKey);
}

type TestApis = Omit<Apis, "fileStore" | "relayPool"> & {
  fileStore: MockFileStore;
  relayPool: MockRelayPool;
};

function applyApis(props?: Partial<TestApis>): TestApis {
  return {
    eventLoadingTimeout: 0,
    timeToStorePreLoginEvents: 0,
    fileStore: props?.fileStore || mockFileStore(),
    relayPool: props?.relayPool || mockRelayPool(),
    finalizeEvent: props?.finalizeEvent || mockFinalizeEvent(),
    nip11: props?.nip11 || {
      searchDebounce: 0,
      fetchRelayInformation: jest.fn().mockReturnValue(
        Promise.resolve({
          suppported_nips: [],
        })
      ),
    },
    ...props,
  };
}

export type UpdateState = () => TestAppState;

type TestAppState = TestDataProps & TestApis;

type TestDataProps = DataContextProps & {
  relays: AllRelays;
};

const DEFAULT_DATA_CONTEXT_PROPS: TestDataProps = {
  user: ALICE,
  contacts: Map<PublicKey, Contact>(),
  contactsRelays: Map<PublicKey, Relays>(),
  knowledgeDBs: Map<PublicKey, KnowledgeData>(),
  semanticIndex: createEmptySemanticIndex(),
  relaysInfos: Map<string, RelayInformation | undefined>(),
  publishEventsStatus: {
    isLoading: false,
    unsignedEvents: List<UnsignedEvent>(),
    results: Map<string, PublishResultsOfEvent>(),
    preLoginEvents: List<UnsignedEvent>(),
    temporaryView: {
      rowFocusIntents: Map<number, RowFocusIntent>(),
      baseSelection: OrderedSet<string>(),
      shiftSelection: OrderedSet<string>(),
      anchor: "",
      editingViews: Set<string>(),
      editorOpenViews: Set<string>(),
      draftTexts: Map<string, string>(),
    },
    temporaryEvents: List(),
  },
  views: Map<string, View>(),
  relays: {
    defaultRelays: TEST_RELAYS,
    userRelays: TEST_RELAYS,
    contactsRelays: [],
  },
  panes: DEFAULT_TEST_PANES,
};

function clonePane(pane: Pane): Pane {
  return {
    ...pane,
    stack: [...pane.stack],
    ...(pane.typeFilters ? { typeFilters: [...pane.typeFilters] } : {}),
  };
}

function rewritePaneForUser(pane: Pane, publicKey: PublicKey): Pane {
  return {
    ...pane,
    author: replaceUnauthenticatedUser(pane.author, publicKey),
    stack: pane.stack.map((id) => replaceUnauthenticatedUser(id, publicKey)),
    ...(pane.rootNodeId
      ? {
          rootNodeId: replaceUnauthenticatedUser(pane.rootNodeId, publicKey),
        }
      : {}),
  };
}

function applyDefaults(props?: Partial<TestAppState>): TestAppState {
  return {
    ...applyApis(props),
    ...DEFAULT_DATA_CONTEXT_PROPS,
    ...props,
  };
}

function createContactsQuery(author: PublicKey): Filter {
  return {
    kinds: [KIND_CONTACTLIST],
    authors: [author],
  };
}

function getContactListEventsOfUser(
  publicKey: PublicKey,
  events: Array<Event>
): List<Event> {
  const query = createContactsQuery(publicKey);
  return List<Event>(events).filter((e) => matchFilter(query, e));
}

function getContacts(appState: TestAppState): Contacts {
  const events = getContactListEventsOfUser(
    appState.user.publicKey,
    appState.relayPool.getEvents()
  );
  return findContacts(events);
}

export function setup(
  users: User[],
  options?: Partial<TestAppState>
): UpdateState[] {
  const appState = applyDefaults(options);
  const basePanes = appState.panes.map(clonePane);
  return users.map((user): UpdateState => {
    return (): TestAppState => {
      const updatedState = {
        ...appState,
        user,
        panes: basePanes.map(clonePane),
      };
      const contacts = appState.contacts.merge(getContacts(updatedState));
      return {
        ...updatedState,
        contacts,
      };
    };
  });
}

type RenderApis = Partial<TestApis> &
  Partial<DataContextProps> & {
    initialRoute?: string;
    user?: User;
    defaultRelays?: Array<string>;
    initialStack?: ID[];
    db?: StashmapDB | null;
    preserveLocation?: boolean;
    relays?: AllRelays;
  };

function TestPublishProvider({
  children,
  initialDataContextProps,
  relays,
  relayPool,
  initialRoute,
  fileStore,
  db,
}: {
  children: React.ReactNode;
  initialDataContextProps: DataContextProps;
  relays: AllRelays;
  relayPool: MockRelayPool;
  initialRoute?: string;
  fileStore: MockFileStore;
  db?: StashmapDB | null;
}): JSX.Element {
  const authUser = useUserOrAnon();
  const [publishEventsStatus, setPublishEventsStatus] = React.useState(
    initialDataContextProps.publishEventsStatus
  );
  const [panes, setPanes] = React.useState(initialDataContextProps.panes);
  const [views, setViews] = React.useState(initialDataContextProps.views);
  const storage = React.useMemo(
    () => createStorageAdapter(fileStore),
    [fileStore]
  );
  const previousUserKeyRef = React.useRef(
    initialDataContextProps.user.publicKey
  );
  const skipNextPersistRef = React.useRef(false);
  const activeUser = authUser || initialDataContextProps.user;
  const { events: metaEvents, eose: metaEventsEose } = useEventQuery(
    relayPool,
    [
      {
        authors: [activeUser.publicKey],
        kinds: [KIND_SETTINGS],
        limit: 1,
      },
      {
        authors: [activeUser.publicKey],
        kinds: [KIND_CONTACTLIST],
        limit: 1,
      },
    ],
    {
      readFromRelays: relays.userRelays,
    }
  );
  const processedMetaEvents = React.useMemo(
    () =>
      mergeEvents(
        processEvents(metaEvents.valueSeq().toList()).get(
          activeUser.publicKey,
          newProcessedEvents()
        ),
        publishEventsStatus.preLoginEvents
      ),
    [activeUser.publicKey, metaEvents, publishEventsStatus.preLoginEvents]
  );
  const contacts = React.useMemo(() => {
    const liveContacts = processedMetaEvents.contacts.filter(
      (_, key) => key !== activeUser.publicKey
    );
    return metaEvents.size > 0
      ? liveContacts
      : initialDataContextProps.contacts;
  }, [
    activeUser.publicKey,
    initialDataContextProps.contacts,
    metaEvents.size,
    processedMetaEvents.contacts,
  ]);
  const { events: contactRelayEvents } = useEventQuery(
    relayPool,
    [
      {
        authors: contacts.keySeq().toArray(),
        kinds: [KIND_RELAY_METADATA_EVENT],
      },
    ],
    {
      readFromRelays: [...relays.defaultRelays, ...relays.userRelays],
      enabled: metaEventsEose,
    }
  );
  const contactsRelays = React.useMemo(() => {
    if (contactRelayEvents.size === 0) {
      return initialDataContextProps.contactsRelays;
    }
    return processEvents(contactRelayEvents.valueSeq().toList()).reduce(
      (acc, processed, key) => acc.set(key, processed.relays),
      initialDataContextProps.contactsRelays.clear()
    );
  }, [contactRelayEvents, initialDataContextProps.contactsRelays]);
  const relaysInfos = useRelaysInfo(
    [...relays.userRelays, ...flattenRelays(contactsRelays)],
    metaEventsEose
  );
  const syncRelayUrls = React.useMemo(
    () => [
      ...new globalThis.Set(
        [
          ...relays.defaultRelays,
          ...relays.userRelays,
          ...relays.contactsRelays,
        ]
          .filter((relay) => relay.read)
          .map((relay) => relay.url)
      ),
    ],
    [relays]
  );
  const repository = React.useMemo(() => {
    if (db) {
      return undefined;
    }
    const state =
      TEST_REPOSITORY_STATES.get(fileStore) ||
      createInMemoryBrowserDocumentRepositoryState();
    // eslint-disable-next-line functional/immutable-data
    TEST_REPOSITORY_STATES.set(fileStore, state);
    return createInMemoryBrowserDocumentRepository({
      relayPool,
      relayUrls: syncRelayUrls,
      state,
    });
  }, [db, fileStore, relayPool, syncRelayUrls]);
  const extraAuthors = React.useMemo(() => {
    const paneAuthors = panes.flatMap((pane) => {
      if (!pane.rootNodeId) {
        return [pane.author];
      }
      const [rootAuthor] = splitID(pane.rootNodeId);
      return rootAuthor ? [pane.author, rootAuthor] : [pane.author];
    });
    const routeAuthor = (() => {
      if (!initialRoute) {
        return undefined;
      }
      try {
        const url = new URL(initialRoute, "https://test.local");
        return url.searchParams.get("author") as PublicKey | null;
      } catch {
        return undefined;
      }
    })();
    return [
      ...new globalThis.Set([
        ...paneAuthors,
        ...(routeAuthor ? [routeAuthor] : []),
      ]),
    ];
  }, [initialRoute, panes]);

  React.useEffect(() => {
    const previousUserKey = previousUserKeyRef.current;
    if (activeUser.publicKey === previousUserKey) {
      return;
    }
    // eslint-disable-next-line functional/immutable-data
    skipNextPersistRef.current = true;
    // eslint-disable-next-line functional/immutable-data
    previousUserKeyRef.current = activeUser.publicKey;

    const savedPanes = loadPanesFromStorage(storage, activeUser.publicKey);
    const savedViews = loadViewsFromStorage(storage, activeUser.publicKey);

    if (savedPanes) {
      setPanes(savedPanes.map(clonePane));
    } else if (previousUserKey === UNAUTHENTICATED_USER_PK) {
      setPanes((current) =>
        current.map((pane) => rewritePaneForUser(pane, activeUser.publicKey))
      );
    } else {
      const nextPanes = getInitialPanes({
        publicKey: activeUser.publicKey,
        pathname: window.location.pathname,
        search: window.location.search,
        historyState: null,
        loadStoredPanes: (publicKey) =>
          loadPanesFromStorage(storage, publicKey),
      });
      setPanes(nextPanes.map(clonePane));
    }

    if (savedViews) {
      setViews(savedViews);
    } else if (previousUserKey !== UNAUTHENTICATED_USER_PK) {
      setViews(DEFAULT_DATA_CONTEXT_PROPS.views);
    }
  }, [activeUser.publicKey, storage]);

  React.useEffect(() => {
    if (skipNextPersistRef.current) {
      // eslint-disable-next-line functional/immutable-data
      skipNextPersistRef.current = false;
      return;
    }
    savePanesToStorage(storage, activeUser.publicKey, panes);
    saveViewsToStorage(storage, activeUser.publicKey, views);
  }, [activeUser.publicKey, panes, storage, views]);

  return (
    <DataContextProvider
      user={activeUser}
      contacts={contacts}
      contactsRelays={contactsRelays}
      knowledgeDBs={initialDataContextProps.knowledgeDBs}
      semanticIndex={initialDataContextProps.semanticIndex}
      relaysInfos={relaysInfos}
      publishEventsStatus={publishEventsStatus}
      views={views}
      panes={panes}
    >
      <GraphProvider
        db={db}
        repository={repository}
        myself={activeUser.publicKey}
        contacts={contacts}
        extraAuthors={extraAuthors}
        defaultRelays={relays.defaultRelays}
        userRelays={relays.userRelays}
        contactsRelays={contactsRelays}
        unpublishedEvents={publishEventsStatus.unsignedEvents}
      >
        <MergeKnowledgeDB>
          <PlanningContextProvider
            setPublishEvents={setPublishEventsStatus}
            setPanes={setPanes}
            setViews={setViews}
            db={db}
            getRelays={() => relays}
          >
            <NavigationStateProvider>{children}</NavigationStateProvider>
          </PlanningContextProvider>
        </MergeKnowledgeDB>
      </GraphProvider>
    </DataContextProvider>
  );
}

export function renderApis(
  children: React.ReactElement,
  options?: RenderApis
): TestApis & RenderResult {
  const { fileStore, relayPool, finalizeEvent, nip11 } = applyApis(options);
  const storage = createStorageAdapter(fileStore);
  const defaultRelayUrls =
    options?.defaultRelays || TEST_RELAYS.map((relay) => relay.url);
  const defaultRelayConfig = defaultRelayUrls.map((url) => ({
    url,
    read: true,
    write: true,
  }));
  const currentRoute = `${window.location.pathname}${window.location.search}`;
  const requestedRoute =
    options?.initialRoute ||
    (options?.preserveLocation === false ? "/" : currentRoute || "/");
  const initialUrl = new URL(requestedRoute, "https://test.local");
  const hasExplicitUser =
    !!options && Object.prototype.hasOwnProperty.call(options, "user");
  const initialUser = hasExplicitUser
    ? options?.user || ANON
    : options?.user || DEFAULT_DATA_CONTEXT_PROPS.user;
  const storedPanes = loadPanesFromStorage(storage, initialUser.publicKey);
  const historyState = window.history.state as { panes?: Pane[] } | null;
  const initialHistoryState =
    options?.preserveLocation === false || storedPanes ? null : historyState;
  const initialPanes = (
    options?.initialRoute || !hasCustomPanes(options?.panes)
      ? getInitialPanes({
          publicKey: initialUser.publicKey,
          pathname: initialUrl.pathname,
          search: initialUrl.search,
          historyState: initialHistoryState,
          loadStoredPanes: (publicKey) =>
            loadPanesFromStorage(storage, publicKey),
        })
      : options.panes
  ).map(clonePane);
  const initialDataContextProps: DataContextProps = {
    user: initialUser,
    contacts: options?.contacts || DEFAULT_DATA_CONTEXT_PROPS.contacts,
    contactsRelays:
      options?.contactsRelays || DEFAULT_DATA_CONTEXT_PROPS.contactsRelays,
    knowledgeDBs:
      options?.knowledgeDBs || DEFAULT_DATA_CONTEXT_PROPS.knowledgeDBs,
    semanticIndex:
      options?.semanticIndex || DEFAULT_DATA_CONTEXT_PROPS.semanticIndex,
    relaysInfos: options?.relaysInfos || DEFAULT_DATA_CONTEXT_PROPS.relaysInfos,
    publishEventsStatus:
      options?.publishEventsStatus ||
      DEFAULT_DATA_CONTEXT_PROPS.publishEventsStatus,
    views:
      (hasCustomViews(options?.views) ? options.views : undefined) ||
      loadViewsFromStorage(storage, initialUser.publicKey) ||
      DEFAULT_DATA_CONTEXT_PROPS.views,
    panes: initialPanes,
  };
  const relays = options?.relays || {
    defaultRelays: defaultRelayConfig,
    userRelays: defaultRelayConfig,
    contactsRelays: DEFAULT_DATA_CONTEXT_PROPS.relays.contactsRelays,
  };

  const authUser = hasExplicitUser
    ? options?.user
    : options?.user || DEFAULT_DATA_CONTEXT_PROPS.user;
  const user =
    authUser && isUserLoggedInWithSeed(authUser)
      ? {
          privateKey: authUser.privateKey,
          publicKey: authUser.publicKey,
        }
      : undefined;
  if (user && user.publicKey && !user.privateKey) {
    fileStore.setLocalStorage("publicKey", user.publicKey);
  } else if (user && user.privateKey) {
    fileStore.setLocalStorage("privateKey", bytesToHex(user.privateKey));
  }
  window.history.replaceState(window.history.state, "", requestedRoute);
  const utils = render(
    <BrowserRouter>
      <ApiProvider
        apis={{
          fileStore,
          relayPool,
          finalizeEvent,
          nip11,
          eventLoadingTimeout: 0,
          timeToStorePreLoginEvents: 0,
        }}
      >
        <NostrAuthContextProvider defaultRelayUrls={defaultRelayUrls}>
          <UserRelayContextProvider>
            <TestPublishProvider
              initialDataContextProps={initialDataContextProps}
              relays={relays}
              relayPool={relayPool}
              initialRoute={options?.initialRoute}
              fileStore={fileStore}
              db={options?.db}
            >
              <PaneIndexProvider index={0}>
                <VirtuosoMockContext.Provider
                  value={{ viewportHeight: 10000, itemHeight: 100 }}
                >
                  {children}
                </VirtuosoMockContext.Provider>
              </PaneIndexProvider>
            </TestPublishProvider>
          </UserRelayContextProvider>
        </NostrAuthContextProvider>
      </ApiProvider>
    </BrowserRouter>
  );
  return {
    fileStore,
    relayPool,
    finalizeEvent,
    nip11,
    eventLoadingTimeout: 0,
    timeToStorePreLoginEvents: 0,
    ...utils,
  };
}

type RenderViewResult = TestApis & RenderResult;

function renderApp(props: RenderApis): RenderViewResult {
  return renderApis(
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route path="follow" element={<Navigate replace to="/" />} />
        <Route path="relays" element={<RelaysWrapper />} />
        <Route path="signin" element={<SignInModal />} />
        <Route path="signup" element={<SignUp />} />
      </Route>
      <Route path="/n/*" element={<AppShell />} />
      <Route path="/r/:nodeId" element={<AppShell />} />
    </Routes>,
    {
      ...props,
      preserveLocation: props.preserveLocation ?? false,
    }
  );
}

export function readonlyRoute(author: string, ...segments: string[]): string {
  return `/n/${segments.map(encodeURIComponent).join("/")}?author=${author}`;
}

export async function forkReadonlyRoot(
  viewer: RenderApis,
  author: string,
  ...segments: string[]
): Promise<void> {
  cleanup();
  renderApp({
    ...viewer,
    initialRoute: readonlyRoute(author, ...segments),
  });
  await screen.findByText("READONLY");
  await waitFor(
    () => {
      expect(screen.queryByText("Error: Node not found")).toBeNull();
    },
    { timeout: 5_000 }
  );
  const copyAction = await screen.findByLabelText(
    /copy root to edit|Open root to make a copy/
  );
  if (copyAction.getAttribute("aria-label") === "copy root to edit") {
    await userEvent.click(copyAction);
    return;
  }
  await userEvent.click(copyAction);
  await screen.findByText("READONLY");
  await userEvent.click(await screen.findByLabelText("copy root to edit"));
}

export async function openReadonlyRoute(nodeLabel: string): Promise<string> {
  await userEvent.click(
    await screen.findByLabelText(`open ${nodeLabel} in fullscreen`)
  );

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });

  return window.location.pathname;
}

export async function follow(
  cU: UpdateState,
  publicKey: PublicKey
): Promise<void> {
  const utils = cU();
  const plan = planUpsertContact(createPlan(utils), { publicKey });
  await execute({
    events: plan.publishEvents,
    user: plan.user,
    relays: utils.relays,
    relayPool: utils.relayPool,
    finalizeEvent: utils.finalizeEvent,
  });
}

export async function unfollow(
  cU: UpdateState,
  publicKey: PublicKey
): Promise<void> {
  const utils = cU();
  const plan = planRemoveContact(createPlan(utils), publicKey);
  await execute({
    events: plan.publishEvents,
    user: plan.user,
    relays: utils.relays,
    relayPool: utils.relayPool,
    finalizeEvent: utils.finalizeEvent,
  });
}

export function renderWithTestData(
  children: React.ReactElement,
  options?: Partial<TestAppState> & {
    initialRoute?: string;
    db?: StashmapDB | null;
  }
): TestAppState & RenderResult {
  const props = applyDefaults(options);
  const utils = renderApis(
    <Routes>
      {["*", "n/*", "r/:nodeId", "d/:openItemID", "join/:projectID"].map(
        (path) => (
          <Route
            key={path}
            path={path}
            element={
              <TemporaryViewProvider>
                <DND>{children}</DND>
              </TemporaryViewProvider>
            }
          />
        )
      )}
    </Routes>,
    {
      ...options,
      preserveLocation: false,
    }
  );
  return { ...props, ...utils };
}

/**
 * Finds the empty "note editor" (for creating new nodes).
 */
export async function findNewNodeEditor(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "new node editor" });
}

/**
 * Types text in the new node editor. Shortcut for userEvent.type(await findNewNodeEditor(), text).
 */
export async function type(text: string): Promise<void> {
  await userEvent.type(await findNewNodeEditor(), text);
}

export async function findEvent(
  relayPool: MockRelayPool,
  filter: Filter
): Promise<(Event & { relays?: string[] }) | undefined> {
  await waitFor(() => {
    expect(
      relayPool.getEvents().filter((e) => matchFilter(filter, e)).length
    ).toBeGreaterThan(0);
  });
  return relayPool.getEvents().find((e) => matchFilter(filter, e));
}

function RootViewOrPaneIsLoadingInner({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const rootNodeID = pane.stack[pane.stack.length - 1] || EMPTY_SEMANTIC_ID;

  return (
    <LoadSearchData itemIDs={pane.stack}>
      <RootViewContextProvider
        root={rootNodeID as LongID}
        paneIndex={paneIndex}
      >
        <StorePreLoginContext>{children}</StorePreLoginContext>
      </RootViewContextProvider>
    </LoadSearchData>
  );
}

export function RootViewOrPaneIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <PaneIndexProvider index={0}>
      <RootViewOrPaneIsLoadingInner>{children}</RootViewOrPaneIsLoadingInner>
    </PaneIndexProvider>
  );
}

/**
 * Gets the tree structure as a readable hierarchical string.
 * Iterates through all .item rows once and classifies each one.
 *
 * Example output:
 *   My Notes
 *     Bitcoin
 *       P2P
 *       Digital Gold
 *     Ethereum
 */
function getIndentLevel(element: HTMLElement): number {
  // eslint-disable-next-line testing-library/no-node-access
  const innerNode = element.closest(".inner-node");
  if (!innerNode) {
    return 0;
  }
  // eslint-disable-next-line testing-library/no-node-access
  const nodeRow = innerNode.querySelector(".node-row");
  if (!nodeRow) {
    return 0;
  }
  // eslint-disable-next-line testing-library/no-node-access
  const directChildren = Array.from(nodeRow.children);
  const count = directChildren.filter((child) =>
    // eslint-disable-next-line testing-library/no-node-access
    child.classList.contains("indent-spacer")
  ).length;
  return Math.max(0, count - 1);
}

type RowInfo = {
  element: HTMLElement;
  text: string;
  indentLevel: number;
  gutter?: string;
};

function getItemPrefix(innerNode: Element | null, isRef: boolean): string {
  const isDeleted = innerNode?.getAttribute("data-deleted") === "true";
  if (isDeleted) return "[D] ";
  const virtualType = innerNode?.getAttribute("data-virtual-type");
  const isOtherUser = innerNode?.getAttribute("data-other-user") === "true";
  if (virtualType === "suggestion") return "[S] ";
  if (virtualType === "version") return isOtherUser ? "[VO] " : "[V] ";
  const typeCharMap: Record<string, string> = {
    incoming: "I",
  };
  const typeChar = typeCharMap[virtualType ?? ""] ?? (isRef ? "R" : "");
  if (isOtherUser && typeChar) return `[O${typeChar}] `;
  if (isOtherUser) return "[O] ";
  if (typeChar) return `[${typeChar}] `;
  return "";
}

function getGutter(row: Element): string | undefined {
  /* eslint-disable testing-library/no-node-access */
  const selector = row.querySelector(".relevance-selector");
  /* eslint-enable testing-library/no-node-access */
  const title = selector?.getAttribute("title");
  if (!title) return undefined;
  const gutterMap: Record<string, string> = {
    Relevant: "!",
    "Maybe Relevant": "?",
    "Little Relevant": "~",
    "Not Relevant": "x",
  };
  return gutterMap[title];
}

function classifyRow(row: Element): RowInfo | null {
  /* eslint-disable testing-library/no-node-access */
  const toggleButton = row.querySelector(
    "button[aria-label^='expand '], button[aria-label^='collapse ']"
  );
  const newNodeEditor = row.querySelector(
    '[role="textbox"][aria-label="new node editor"]'
  );
  const innerNode = row.querySelector(".inner-node");
  const referenceRow = row.querySelector('[data-testid="reference-row"]');
  const noteEditor = innerNode?.querySelector(
    '[role="textbox"][aria-label^="edit "]'
  );
  /* eslint-enable testing-library/no-node-access */
  const gutter = getGutter(row);

  const prefix = getItemPrefix(innerNode, !!referenceRow);

  const withGutter = (info: RowInfo): RowInfo => ({ ...info, gutter });

  if (newNodeEditor) {
    const content = newNodeEditor.textContent?.trim();
    const text = content ? `[NEW NODE: ${content}]` : "[NEW NODE]";
    return withGutter({
      element: newNodeEditor as HTMLElement,
      text,
      indentLevel: getIndentLevel(newNodeEditor as HTMLElement),
    });
  }

  if (toggleButton) {
    const getRawText = (): string => {
      const labelText = (toggleButton.getAttribute("aria-label") || "").replace(
        /^(expand|collapse) /,
        ""
      );
      if (labelText) {
        return labelText;
      }
      /* eslint-disable testing-library/no-node-access */
      const textSpan = innerNode?.querySelector(".break-word");
      /* eslint-enable testing-library/no-node-access */
      return (
        noteEditor?.textContent?.trim() || textSpan?.textContent?.trim() || ""
      );
    };
    const rawText = getRawText();
    if (!rawText) {
      return null;
    }
    return withGutter({
      element: toggleButton as HTMLElement,
      text: `${prefix}${rawText}`,
      indentLevel: getIndentLevel(toggleButton as HTMLElement),
    });
  }

  if (referenceRow) {
    const rawText = referenceRow.textContent?.trim() || "";
    const cleanText = rawText
      .replace(/👤/g, "")
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .trim();
    const displayText = prefix.startsWith("[V")
      ? (cleanText.match(/[+-]\d+/g) || []).join(" ")
      : cleanText;
    return withGutter({
      element: referenceRow as HTMLElement,
      text: `${prefix}${displayText}`.trimEnd(),
      indentLevel: getIndentLevel(referenceRow as HTMLElement),
    });
  }

  if (prefix && innerNode) {
    /* eslint-disable testing-library/no-node-access */
    const textSpan = innerNode.querySelector(".break-word");
    /* eslint-enable testing-library/no-node-access */
    const rawText =
      textSpan?.textContent?.trim() || noteEditor?.textContent?.trim() || "";
    return withGutter({
      element: innerNode as HTMLElement,
      text: `${prefix}${rawText}`,
      indentLevel: getIndentLevel(innerNode as HTMLElement),
    });
  }

  if (noteEditor) {
    const rawText = noteEditor.textContent?.trim() || "";
    if (!rawText) {
      return null;
    }
    return withGutter({
      element: noteEditor as HTMLElement,
      text: rawText,
      indentLevel: getIndentLevel(noteEditor as HTMLElement),
    });
  }

  /* eslint-disable testing-library/no-node-access */
  const readOnlyText = innerNode?.querySelector(".break-word");
  /* eslint-enable testing-library/no-node-access */
  if (readOnlyText) {
    const rawText = readOnlyText.textContent?.trim() || "";
    if (!rawText) {
      return null;
    }
    return withGutter({
      element: readOnlyText as HTMLElement,
      text: rawText,
      indentLevel: getIndentLevel(readOnlyText as HTMLElement),
    });
  }

  return null;
}

type TreeOptions = {
  showGutter?: boolean;
};

async function getTreeStructure(options?: TreeOptions): Promise<string> {
  await waitFor(() => {
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  /* eslint-disable testing-library/no-node-access */
  const allRows = document.querySelectorAll(".item");
  /* eslint-enable testing-library/no-node-access */

  const rowInfos: RowInfo[] = Array.from(allRows)
    .map((row) => classifyRow(row))
    .filter((info): info is RowInfo => info !== null);

  const lines = rowInfos.map(({ text, indentLevel, gutter }) => {
    const indent = "  ".repeat(indentLevel);
    const gutterPrefix = options?.showGutter && gutter ? `{${gutter}} ` : "";
    return `${indent}${gutterPrefix}${text}`;
  });

  return lines.join("\n");
}

/**
 * Asserts the tree matches the expected structure.
 * Pass a template string with 2-space indentation per level.
 * Options: { showGutter: true } appends relevance symbols as {!} {?} etc.
 */
export async function expectTree(
  expected: string,
  options?: TreeOptions
): Promise<void> {
  const expectedNormalized = expected
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

  try {
    await waitFor(async () => {
      const actual = await getTreeStructure(options);
      expect(actual).toEqual(expectedNormalized);
    });
  } catch (error) {
    const actual = await getTreeStructure(options);
    // eslint-disable-next-line no-console
    console.log(`ACTUAL TREE:\n${actual}`);
    // eslint-disable-next-line no-console
    console.log(`EXPECTED TREE:\n${expectedNormalized}`);
    throw error;
  }
}

/**
 * Standard test setup - renders the tree view.
 * The root node "My Notes" is already visible and expanded.
 */
export function renderTree(
  user: ReturnType<typeof setup>[0]
): RenderViewResult {
  return renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    user()
  );
}

export async function createAndSetAsRoot(nodeName: string): Promise<void> {
  await type(`${nodeName}{Escape}`);
}

export const textContent =
  (text: string): MatcherFunction =>
  (_, el) =>
    el?.textContent === text &&
    // eslint-disable-next-line testing-library/no-node-access
    Array.from(el?.children || []).every((child) => child.textContent !== text);

export function getPane(paneIndex: number): ReturnType<typeof within> {
  // eslint-disable-next-line testing-library/no-node-access
  const el = document.querySelector(
    `[data-pane-index="${paneIndex}"]`
  ) as HTMLElement;
  return within(el);
}

export async function navigateToNodeViaSearch(
  paneIndex: number,
  nodeName: string
): Promise<void> {
  await userEvent.click(
    await screen.findByLabelText(`Search to change pane ${paneIndex} content`)
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    `${nodeName}{Enter}`
  );
  // eslint-disable-next-line testing-library/no-node-access
  const paneContainer = document.querySelector(
    `[data-pane-index="${paneIndex}"]`
  ) as HTMLElement;
  const paneScope = paneContainer ? within(paneContainer) : screen;

  await waitFor(() => {
    // eslint-disable-next-line testing-library/prefer-screen-queries
    const navigateLinks = paneScope.queryAllByRole("link", {
      name: new RegExp(`Navigate to.*${nodeName}`, "i"),
    });
    expect(navigateLinks.length).toBeGreaterThan(0);
  });
  // eslint-disable-next-line testing-library/prefer-screen-queries
  const navigateButtons = paneScope.getAllByRole("link", {
    name: new RegExp(`Navigate to.*${nodeName}`, "i"),
  });
  const exactNavigateButton =
    navigateButtons.find(
      (button) =>
        button.getAttribute("aria-label") === `Navigate to ${nodeName}`
    ) || navigateButtons[0];
  await userEvent.click(exactNavigateButton);

  // Navigation can finish before descendants are rendered; wait for the target
  // row/editor without relying on expand/collapse controls.
  await waitFor(() => {
    const hasEditor = screen.queryAllByLabelText(`edit ${nodeName}`).length > 0;
    const hasTreeRow =
      screen.queryAllByRole("treeitem", { name: nodeName }).length > 0;
    expect(hasEditor || hasTreeRow).toBe(true);
  });

  // Search results are crefs, so navigation lands on the parent context.
  // Click the fullscreen button to make the target node the pane root.
  const fullscreenButtons = screen.queryAllByLabelText(
    `open ${nodeName} in fullscreen`
  );
  if (fullscreenButtons.length > 0) {
    await userEvent.click(fullscreenButtons[fullscreenButtons.length - 1]);
    await waitFor(() => {
      const hasEditor =
        screen.queryAllByLabelText(`edit ${nodeName}`).length > 0;
      const hasTreeRow =
        screen.queryAllByRole("treeitem", { name: nodeName }).length > 0;
      expect(hasEditor || hasTreeRow).toBe(true);
    });
  }
}

function getDropDepthLimits(
  sourceName: string,
  targetName: string
): { minDepth: number; maxDepth: number } {
  /* eslint-disable testing-library/no-node-access */
  const allRows = Array.from(document.querySelectorAll(".item"));
  /* eslint-enable testing-library/no-node-access */

  const sourceRow = allRows.find(
    (r) => r.getAttribute("data-node-text") === sourceName
  );
  const targetRow = allRows.find(
    (r) => r.getAttribute("data-node-text") === targetName
  );
  if (!sourceRow || !targetRow) {
    throw new Error(
      `Could not find source "${sourceName}" or target "${targetName}" in tree`
    );
  }

  const targetIndex = allRows.indexOf(targetRow);
  const nextRow = allRows[targetIndex + 1];

  const currentDepth = Number(targetRow.getAttribute("data-row-depth"));
  const nextDepth = nextRow
    ? Number(nextRow.getAttribute("data-row-depth"))
    : undefined;
  const nextRowPathStr = nextRow
    ? nextRow.getAttribute("data-view-key") ?? undefined
    : undefined;
  const sourcePathStr = sourceRow.getAttribute("data-view-key") ?? undefined;

  const rootDepth = Math.min(
    ...allRows.map((r) => Number(r.getAttribute("data-row-depth")))
  );

  return computeDepthLimits(
    currentDepth,
    nextDepth,
    nextRowPathStr,
    sourcePathStr,
    rootDepth
  );
}

export function setDropIndentLevel(
  sourceName: string,
  targetName: string,
  depth: number
): void {
  const { minDepth, maxDepth } = getDropDepthLimits(sourceName, targetName);
  if (depth < minDepth || depth > maxDepth) {
    throw new Error(
      `Depth ${depth} is outside allowed range [${minDepth}, ${maxDepth}] ` +
        `when dragging "${sourceName}" onto "${targetName}"`
    );
  }
  setDropIndentDepth(depth);
}

export function expectIndentationLimits(
  sourceName: string,
  targetName: string
): { toBe: (min: number, max: number) => void } {
  const { minDepth, maxDepth } = getDropDepthLimits(sourceName, targetName);
  return {
    toBe(min: number, max: number) {
      expect(minDepth).toBe(min);
      expect(maxDepth).toBe(max);
    },
  };
}

export { ALICE, renderApp, mockRelayPool };
