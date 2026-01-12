import React from "react";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { List, Map } from "immutable";
import {
  render,
  screen,
  waitFor,
  MatcherFunction,
  RenderResult,
} from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
import { Container } from "react-dom";
import { VirtuosoMockContext } from "react-virtuoso";
import { v4 } from "uuid";
import {
  FocusContext,
  FocusContextProvider,
} from "./commons/FocusContextProvider";
import { KIND_CONTACTLIST, KIND_PROJECT, newTimestamp } from "./nostr";
import { RequireLogin, UNAUTHENTICATED_USER_PK } from "./AppState";
import {
  Plan,
  createPlan,
  planAddContact,
  planRemoveContact,
  planUpsertNode,
  planUpsertRelations,
  relayTags,
} from "./planner";
import { execute } from "./executor";
import { ApiProvider, Apis, FinalizeEvent } from "./Apis";
import { App } from "./App";
import { DataContextProps } from "./DataContext";
import { MockRelayPool, mockRelayPool } from "./nostrMock.test";
import { DEFAULT_SETTINGS } from "./settings";
import {
  NostrAuthContextProvider,
  isUserLoggedInWithSeed,
} from "./NostrAuthContext";
import {
  addRelationToRelations,
  getRelationsNoReferencedBy,
  joinID,
  newNode,
  shortID,
} from "./connections";
import { newRelations, RootViewContextProvider } from "./ViewContext";
import { LoadNode } from "./dataQuery";
import { StorePreLoginContext } from "./StorePreLoginContext";
import { useWorkspaceContext } from "./WorkspaceContext";
import { newDB } from "./knowledge";
import { TemporaryViewProvider } from "./components/TemporaryViewContext";
import { DND } from "./dnd";
import { findContacts } from "./contacts";
import { ProjectContextProvider } from "./ProjectContext";
import { NavigationStackProvider } from "./NavigationStackContext";
import {
  SplitPanesProvider,
  PaneNavigationProvider,
  PaneIndexProvider,
  usePaneNavigation,
  usePaneIndex,
} from "./SplitPanesContext";
import { ROOT } from "./types";

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});

export const ALICE_PRIVATE_KEY =
  "04d22f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";

export const BOB_PRIVATE_KEY =
  "00000f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";

export const BOB_PUBLIC_KEY =
  "71a20276981b2a5019f634adfe10accd7e188f3eb5f57079da52de40b742a923" as PublicKey;

export const CAROL_PRIVATE_KEY =
  "10000f1cf58c28647c7b7dc198dcbc4de860948933e56001ab9fc17e1b8d072e";
export const CAROL_PUBLIC_KEY =
  "074eb94a7a3d34102b563b540ac505e4fa8f71e3091f1e39a77d32e813c707d2" as PublicKey;

export const STASHMAP_PUBLIC_KEY =
  "0d88016ab939e885e59c0cb7775fe06cdfa94bce46547c8b37a87a02130e4e76" as PublicKey;
export const STASHMAP_PRIVATE_KEY =
  "cdf051a1564177fa20bb831847011e8d4e5168ed8f74448c82c4279bf8766512";

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

const UNAUTHENTICATED_BOB: Contact = {
  publicKey: BOB_PUBLIC_KEY,
};

export const BOB: KeyPair = {
  publicKey: BOB_PUBLIC_KEY,
  privateKey: hexToBytes(BOB_PRIVATE_KEY),
};

const UNAUTHENTICATED_CAROL: Contact = {
  publicKey: CAROL_PUBLIC_KEY,
};

export const CAROL: User = {
  publicKey: CAROL_PUBLIC_KEY,
  privateKey: hexToBytes(CAROL_PRIVATE_KEY),
};

export const bobsNip05Identifier = "bob@bobsdomain.com";

export const TEST_RELAYS = [
  { url: "wss://relay.test.first.success/", read: true, write: true },
  { url: "wss://relay.test.second.fail/", read: true, write: true },
  { url: "wss://relay.test.third.rand/", read: true, write: true },
  { url: "wss://relay.test.fourth.success/", read: true, write: true },
];

type MockFileStore = LocalStorage & {
  getLocalStorageData: () => Map<string, string>;
};

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

export function finalizeEventWithoutWasm(
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
  activeWorkspace: LongID;
  relays: AllRelays;
};

const DEFAULT_DATA_CONTEXT_PROPS: TestDataProps = {
  user: ALICE,
  contacts: Map<PublicKey, Contact>(),
  settings: DEFAULT_SETTINGS,
  contactsRelays: Map<PublicKey, Relays>(),
  knowledgeDBs: Map<PublicKey, KnowledgeData>(),
  relaysInfos: Map<string, RelayInformation | undefined>(),
  publishEventsStatus: {
    isLoading: false,
    unsignedEvents: List<UnsignedEvent>(),
    results: Map<string, PublishResultsOfEvent>(),
    preLoginEvents: List<UnsignedEvent>(),
  },
  views: Map<string, View>(),
  activeWorkspace: joinID(STASHMAP_PUBLIC_KEY, "ws") as LongID,
  relays: {
    defaultRelays: [{ url: "wss://default.relay", read: true, write: true }],
    userRelays: [{ url: "wss://user.relay", read: true, write: true }],
    projectRelays: [{ url: "wss://project.relay", read: true, write: true }],
    contactsRelays: [{ url: "wss://contacts.relay", read: true, write: true }],
  },
  projectMembers: Map<PublicKey, Member>(),
};

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
  return users.map((user): UpdateState => {
    return (): TestAppState => {
      const updatedState = {
        ...appState,
        user,
      };
      const contacts = appState.contacts.merge(getContacts(updatedState));
      return {
        ...updatedState,
        contacts,
      };
    };
  });
}

export function findNodeByText(plan: Plan, text: string): KnowNode | undefined {
  const { knowledgeDBs, user } = plan;
  return knowledgeDBs
    .get(user.publicKey, newDB())
    .nodes.find((node) => node.text === text);
}

function createInitialWorkspace(
  plan: Plan,
  activeWorkspace?: string
): [Plan, nodeID: LongID] {
  const wsNode = activeWorkspace
    ? findNodeByText(plan, activeWorkspace)
    : newNode("My Notes", plan.user.publicKey);
  if (!wsNode) {
    throw new Error(
      `Test Setup Error: No Node with text ${activeWorkspace} found`
    );
  }

  const planWithNode = activeWorkspace ? plan : planUpsertNode(plan, wsNode);
  return [planWithNode, wsNode.id];
}

type RenderApis = Partial<TestApis> & {
  initialRoute?: string;
  includeFocusContext?: boolean;
  user?: User;
  defaultRelays?: Array<string>;
};

export function renderApis(
  children: React.ReactElement,
  options?: RenderApis
): TestApis & RenderResult {
  const { fileStore, relayPool, finalizeEvent, nip11 } = applyApis(options);

  // If user is explicity undefined it will be overwritten, if not set default Alice is used
  const optionsWithDefaultUser = {
    user: ALICE,
    ...options,
  };
  const user =
    optionsWithDefaultUser.user &&
    isUserLoggedInWithSeed(optionsWithDefaultUser.user)
      ? {
          privateKey: optionsWithDefaultUser.user.privateKey,
          publicKey: optionsWithDefaultUser.user.publicKey,
        }
      : undefined;
  if (user && user.publicKey && !user.privateKey) {
    fileStore.setLocalStorage("publicKey", user.publicKey);
  } else if (user && user.privateKey) {
    fileStore.setLocalStorage("privateKey", bytesToHex(user.privateKey));
  }
  window.history.pushState({}, "", options?.initialRoute || "/");
  const utils = render(
    <BrowserRouter>
      <NavigationStackProvider>
        <SplitPanesProvider>
          <PaneIndexProvider index={0}>
            <PaneNavigationProvider initialWorkspace={ROOT}>
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
                <NostrAuthContextProvider
                  defaultRelayUrls={
                    optionsWithDefaultUser.defaultRelays ||
                    TEST_RELAYS.map((r) => r.url)
                  }
                >
                  <ProjectContextProvider>
                    <VirtuosoMockContext.Provider
                      value={{ viewportHeight: 10000, itemHeight: 100 }}
                    >
                      {" "}
                      {options?.includeFocusContext === true ? (
                        <FocusContextProvider>{children}</FocusContextProvider>
                      ) : (
                        <FocusContext.Provider
                          value={{
                            isInputElementInFocus: true,
                            setIsInputElementInFocus: jest.fn(),
                          }}
                        >
                          {children}
                        </FocusContext.Provider>
                      )}
                    </VirtuosoMockContext.Provider>
                  </ProjectContextProvider>
                </NostrAuthContextProvider>
              </ApiProvider>
            </PaneNavigationProvider>
          </PaneIndexProvider>
        </SplitPanesProvider>
      </NavigationStackProvider>
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
  const testApis = applyApis(props);
  return renderApis(<App />, {
    ...testApis,
    includeFocusContext: props.includeFocusContext,
  });
}

export function waitForLoadingToBeNull(): Promise<void> {
  return waitFor(
    () => {
      expect(screen.queryByLabelText("loading")).toBeNull();
    },
    {
      // it tests which use real encryption can be slow
      timeout: 10000,
    }
  );
}
export async function follow(
  cU: UpdateState,
  publicKey: PublicKey
): Promise<void> {
  const utils = cU();
  const plan = planAddContact(createPlan(utils), publicKey);
  await execute({
    ...utils,
    plan,
  });
}

export async function unfollow(
  cU: UpdateState,
  publicKey: PublicKey
): Promise<void> {
  const utils = cU();
  const plan = planRemoveContact(createPlan(utils), publicKey);
  await execute({
    ...utils,
    plan,
  });
}

export function renderWithTestData(
  children: React.ReactElement,
  options?: Partial<TestAppState> & {
    initialRoute?: string;
  }
): TestAppState & RenderResult {
  const props = applyDefaults(options);
  const utils = renderApis(
    <Routes>
      <Route element={<RequireLogin />}>
        {["*", "w/:workspaceID/*", "d/:openNodeID", "join/:projectID"].map(
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
      </Route>
    </Routes>,
    props
  );
  return { ...props, ...utils };
}

// @Deprecated
export function expectTextContent(
  element: HTMLElement,
  textContent: Array<string>
): void {
  expect(element.textContent).toEqual(textContent.join(""));
}

function isElementMatchingSearchText(
  text: string,
  element: Element | null
): boolean {
  if (
    element === null ||
    element === undefined ||
    element.textContent === null ||
    element.textContent === ""
  ) {
    return false;
  }
  const searchTextParts = text.split(" ");
  return searchTextParts.every((part: string) =>
    element.textContent?.includes(part)
  );
}

function isNoChildDivElements(element: Element | null): boolean {
  if (element === null) {
    return true;
  }
  return Array.from(element.children).every((child) => child.tagName !== "DIV");
}

export function matchSplitText(text: string): MatcherFunction {
  const customTextMatcher = (
    content: string,
    element: Element | null
  ): boolean => {
    if (
      isElementMatchingSearchText(text, element) &&
      isNoChildDivElements(element)
    ) {
      // eslint-disable-next-line testing-library/no-node-access
      const childElements = element ? Array.from(element.children) : [];
      const foundChildElements = childElements.filter((child) =>
        isElementMatchingSearchText(text, child)
      );
      return foundChildElements.length === 0;
    }
    return false;
  };
  return customTextMatcher;
}

export async function typeNewNode(
  view: RenderResult,
  text: string
): Promise<void> {
  await userEvent.click(await screen.findByText("Add Note"));
  /* eslint-disable testing-library/no-container */
  /* eslint-disable testing-library/no-node-access */
  const input = view.container.querySelector(
    '[data-placeholder="Create a Note"]'
  ) as Element;
  await userEvent.type(input, text);
  await userEvent.click(await screen.findByText("Add Note"));
  await screen.findByText(text);
}

type NodeDescription = [
  string | KnowNode,
  (NodeDescription[] | (string | KnowNode)[])?
];

function createNodesAndRelations(
  plan: Plan,
  currentRelationsID: LongID | undefined,
  nodes: NodeDescription[],
  context: Context = List()
): Plan {
  return List(nodes).reduce((rdx: Plan, nodeDescription: NodeDescription) => {
    const currentRelations = currentRelationsID
      ? getRelationsNoReferencedBy(
          rdx.knowledgeDBs,
          currentRelationsID,
          rdx.user.publicKey
        )
      : undefined;
    const textOrNode = Array.isArray(nodeDescription)
      ? nodeDescription[0]
      : nodeDescription;
    const children = Array.isArray(nodeDescription)
      ? (nodeDescription[1] as NodeDescription[] | undefined)
      : undefined;
    const node =
      typeof textOrNode === "string"
        ? newNode(textOrNode, rdx.user.publicKey)
        : textOrNode;
    // no need to upsert if it's already a node
    const planWithNode =
      typeof textOrNode === "string" ? planUpsertNode(rdx, node) : rdx;
    // Add Node to current relation
    const planWithUpdatedRelation = currentRelations
      ? planUpsertRelations(
          planWithNode,
          addRelationToRelations(currentRelations, node.id)
        )
      : planWithNode;
    if (children) {
      // Create relations with current context (path to this node)
      const relationForChildren = newRelations(
        node.id,
        context,
        rdx.user.publicKey
      );
      const planWithRelations = planUpsertRelations(
        planWithUpdatedRelation,
        relationForChildren
      );
      // Children's context includes this node (including workspace root)
      const childContext = context.push(shortID(node.id));
      return createNodesAndRelations(
        planWithRelations,
        relationForChildren.id,
        children,
        childContext
      );
    }
    return planWithUpdatedRelation;
  }, plan);
}

type Options = {
  activeWorkspace: string;
};

export async function setupTestDB(
  appState: TestAppState,
  nodes: NodeDescription[],
  options?: Options
): Promise<Plan> {
  const plan = createNodesAndRelations(createPlan(appState), undefined, nodes);
  const [planWithWs, id] = options?.activeWorkspace
    ? createInitialWorkspace(plan, options?.activeWorkspace)
    : [plan, appState.activeWorkspace];

  await execute({
    ...appState,
    plan: planWithWs,
    finalizeEvent: mockFinalizeEvent(),
  });
  return {
    ...planWithWs,
    activeWorkspace: id,
  };
}

export function extractNodes(container: Container): Array<string | null> {
  const allDraggables = container.querySelectorAll(
    "[data-item-index] .inner-node .break-word"
  );
  return Array.from(allDraggables).map((el) => el.textContent);
}

export function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// Move this to planner.tsx whenever we support creating projects
export function planUpsertProjectNode(plan: Plan, node: ProjectNode): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.set(shortID(node.id), node);
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const updateNodeEvent = {
    kind: KIND_PROJECT,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["d", shortID(node.id)],
      ["memberListProvider", node.memberListProvider],
      ...(node.address ? [["address", node.address]] : []),
      ...(node.imageUrl ? [["imageUrl", `url ${node.imageUrl}`]] : []),
      ...(node.perpetualVotes ? [["perpetualVotes", node.perpetualVotes]] : []),
      ...(node.quarterlyVotes ? [["quarterlyVotes", node.quarterlyVotes]] : []),
      // Needs to be indexed by relays so we can see if a dashboard is part of a project
      ...(node.dashboardInternal ? [["c", node.dashboardInternal]] : []),
      ...(node.dashboardPublic
        ? [["dashboardPublic", node.dashboardPublic]]
        : []),
      ...(node.tokenSupply ? [["tokenSupply", `${node.tokenSupply}`]] : []),
      ...relayTags(node.relays),
    ],
    content: node.text,
  };
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    publishEvents: plan.publishEvents.push(updateNodeEvent),
  };
}

export function createExampleProject(publicKey: PublicKey): ProjectNode {
  return {
    createdAt: new Date(),
    id: joinID(publicKey, v4()),
    text: "Winchester Mystery House",
    address: "525 S. Winchester Blvd. San Jose, CA 95128",
    memberListProvider: CAROL.publicKey,
    type: "project",
    imageUrl:
      "url https://partnersinternational.pl/wp-content/uploads/2023/03/Premium-real-estate-office-Warsaw.jpg",
    relays: [
      { url: "wss://winchester.deedsats.com/", write: true, read: true },
      { url: "wss://nos.lol/", write: false, read: true },
    ],
    tokenSupply: 1000000,
  };
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

function RootViewOrWorkspaceIsLoadingInner({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { activeWorkspace } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  return (
    <RootViewContextProvider
      root={activeWorkspace as LongID}
      paneIndex={paneIndex}
    >
      <LoadNode waitForEose>
        <StorePreLoginContext>{children}</StorePreLoginContext>
      </LoadNode>
    </RootViewContextProvider>
  );
}

export function RootViewOrWorkspaceIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { activeWorkspace } = useWorkspaceContext();

  return (
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={activeWorkspace}>
          <RootViewOrWorkspaceIsLoadingInner>
            {children}
          </RootViewOrWorkspaceIsLoadingInner>
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );
}

export { ALICE, UNAUTHENTICATED_BOB, UNAUTHENTICATED_CAROL, renderApp };
