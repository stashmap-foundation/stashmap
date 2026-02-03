import React from "react";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import { List, Map, Set, OrderedSet } from "immutable";
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
import {
  FocusContext,
  FocusContextProvider,
} from "./commons/FocusContextProvider";
import { KIND_CONTACTLIST } from "./nostr";
import { RequireLogin, UNAUTHENTICATED_USER_PK } from "./AppState";
import {
  Plan,
  createPlan,
  planAddContact,
  planRemoveContact,
  planUpsertNode,
  planUpsertRelations,
  PlanningContextProvider,
} from "./planner";
import { execute } from "./executor";
import { ApiProvider, Apis, FinalizeEvent } from "./Apis";
import { App } from "./App";
import { DataContextProps, DataContextProvider } from "./DataContext";
import { MockRelayPool, mockRelayPool } from "./nostrMock.test";
import {
  NostrAuthContextProvider,
  isUserLoggedInWithSeed,
} from "./NostrAuthContext";
import {
  addRelationToRelations,
  getRelationsNoReferencedBy,
  newNode,
  shortID,
} from "./connections";
import { newRelations, RootViewContextProvider } from "./ViewContext";
import { LoadData } from "./dataQuery";
import { LoadSearchData } from "./LoadSearchData";
import { StorePreLoginContext } from "./StorePreLoginContext";
import { newDB } from "./knowledge";
import { TemporaryViewProvider } from "./components/TemporaryViewContext";
import { WorkspaceView } from "./components/Workspace";
import { DND } from "./dnd";
import { findContacts } from "./contacts";
import { UserRelayContextProvider } from "./UserRelayContext";
import { NavigationStackProvider } from "./NavigationStackContext";
import {
  PaneIndexProvider,
  useCurrentPane,
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
  relays: AllRelays;
};

const DEFAULT_DATA_CONTEXT_PROPS: TestDataProps = {
  user: ALICE,
  contacts: Map<PublicKey, Contact>(),
  contactsRelays: Map<PublicKey, Relays>(),
  knowledgeDBs: Map<PublicKey, KnowledgeData>(),
  relaysInfos: Map<string, RelayInformation | undefined>(),
  publishEventsStatus: {
    isLoading: false,
    unsignedEvents: List<UnsignedEvent>(),
    results: Map<string, PublishResultsOfEvent>(),
    preLoginEvents: List<UnsignedEvent>(),
    temporaryView: {
      selection: OrderedSet<string>(),
      multiselectBtns: Set<string>(),
      editingViews: Set<string>(),
      editorOpenViews: Set<string>(),
      draftTexts: Map<string, string>(),
    },
    temporaryEvents: List(),
  },
  views: Map<string, View>(),
  relays: {
    defaultRelays: [{ url: "wss://default.relay", read: true, write: true }],
    userRelays: [{ url: "wss://user.relay", read: true, write: true }],
    contactsRelays: [{ url: "wss://contacts.relay", read: true, write: true }],
  },
  projectMembers: Map<PublicKey, Member>(),
  panes: [{ id: "pane-0", stack: [ROOT], author: ALICE.publicKey }],
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

function createInitialRoot(plan: Plan, rootText?: string): [Plan, nodeID: ID] {
  const rootNode = rootText
    ? findNodeByText(plan, rootText)
    : newNode("My Notes");
  if (!rootNode) {
    throw new Error(`Test Setup Error: No Node with text ${rootText} found`);
  }

  const planWithNode = rootText ? plan : planUpsertNode(plan, rootNode);
  return [planWithNode, rootNode.id];
}

type RenderApis = Partial<TestApis> & {
  initialRoute?: string;
  includeFocusContext?: boolean;
  user?: User;
  defaultRelays?: Array<string>;
  initialStack?: (LongID | ID)[];
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
          {/* eslint-disable-next-line react/jsx-props-no-spreading */}
          <DataContextProvider {...DEFAULT_DATA_CONTEXT_PROPS}>
            <PlanningContextProvider setPublishEvents={() => {}}>
              <NostrAuthContextProvider
                defaultRelayUrls={
                  optionsWithDefaultUser.defaultRelays ||
                  TEST_RELAYS.map((r) => r.url)
                }
              >
                <UserRelayContextProvider>
                  <PaneIndexProvider index={0}>
                    <VirtuosoMockContext.Provider
                      value={{ viewportHeight: 10000, itemHeight: 100 }}
                    >
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
                  </PaneIndexProvider>
                </UserRelayContextProvider>
              </NostrAuthContextProvider>
            </PlanningContextProvider>
          </DataContextProvider>
        </ApiProvider>
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

/**
 * Finds the empty "note editor" (for creating new nodes).
 */
export async function findNewNodeEditor(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "new node editor" });
}

export async function typeNewNode(
  view: RenderResult,
  text: string
): Promise<void> {
  // Click on My Notes editor and press Enter to create a new node
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");

  // Type the text in the new node editor and press Enter to save
  await userEvent.type(await findNewNodeEditor(), `${text}{Enter}`);

  // Verify the text appears in the tree
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
      typeof textOrNode === "string" ? newNode(textOrNode) : textOrNode;
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
  root: string;
};

export async function setupTestDB(
  appState: TestAppState,
  nodes: NodeDescription[],
  options?: Options
): Promise<Plan> {
  const plan = createNodesAndRelations(createPlan(appState), undefined, nodes);
  const defaultRoot =
    appState.panes[0].stack[appState.panes[0].stack.length - 1];
  const [planWithRoot] = options?.root
    ? createInitialRoot(plan, options.root)
    : [plan, defaultRoot];

  await execute({
    ...appState,
    plan: planWithRoot,
    finalizeEvent: mockFinalizeEvent(),
  });
  return planWithRoot;
}

export function extractNodes(container: Container): Array<string | null> {
  /* eslint-disable testing-library/no-node-access */
  // Find both read-only nodes (.break-word) and editable nodes ([role="textbox"])
  const readOnlyNodes = container.querySelectorAll(
    "[data-item-index] .inner-node .break-word"
  );
  const editableNodes = container.querySelectorAll(
    '[data-item-index] .inner-node [role="textbox"][aria-label="note editor"]'
  );
  // Combine and sort by document order using toSorted() for immutability
  const allNodes = [...Array.from(readOnlyNodes), ...Array.from(editableNodes)];
  // Sort by document position to get correct order
  /* eslint-disable functional/immutable-data, no-bitwise */
  const sortedNodes = [...allNodes].sort((a, b) => {
    const position = a.compareDocumentPosition(b);
    if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return -1;
    if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return 1;
    return 0;
  });
  /* eslint-enable functional/immutable-data, no-bitwise */
  /* eslint-enable testing-library/no-node-access */
  return sortedNodes.map((el) => el.textContent);
}

export function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
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
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const rootNodeID = pane.stack[pane.stack.length - 1];

  return (
    <LoadSearchData nodeIDs={pane.stack}>
      <LoadData nodeIDs={pane.stack}>
        <LoadData nodeIDs={[rootNodeID]} descendants referencedBy lists>
          <RootViewContextProvider
            root={rootNodeID as LongID}
            paneIndex={paneIndex}
          >
            <StorePreLoginContext>{children}</StorePreLoginContext>
          </RootViewContextProvider>
        </LoadData>
      </LoadData>
    </LoadSearchData>
  );
}

export function RootViewOrWorkspaceIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <PaneIndexProvider index={0}>
      <RootViewOrWorkspaceIsLoadingInner>
        {children}
      </RootViewOrWorkspaceIsLoadingInner>
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
};

function classifyRow(row: Element): RowInfo | null {
  /* eslint-disable testing-library/no-node-access */
  const toggleButton = row.querySelector(
    "button[aria-label^='expand '], button[aria-label^='collapse ']"
  );
  const newNodeEditor = row.querySelector(
    '[role="textbox"][aria-label="new node editor"]'
  );
  const innerNode = row.querySelector(".inner-node");
  const isSuggestion = innerNode?.getAttribute("data-suggestion") === "true";
  const referenceNode = row.querySelector('[data-testid="reference-node"]');
  const isOtherUser = referenceNode?.getAttribute("data-other-user") === "true";
  const noteEditor = innerNode?.querySelector(
    '[role="textbox"][aria-label^="edit "]'
  );
  /* eslint-enable testing-library/no-node-access */

  if (newNodeEditor) {
    const content = newNodeEditor.textContent?.trim();
    const text = content ? `[NEW NODE: ${content}]` : "[NEW NODE]";
    return {
      element: newNodeEditor as HTMLElement,
      text,
      indentLevel: getIndentLevel(newNodeEditor as HTMLElement),
    };
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
    const getPrefix = (): string => {
      if (isSuggestion) return "[S] ";
      if (isOtherUser) return "[O] ";
      return "";
    };
    return {
      element: toggleButton as HTMLElement,
      text: `${getPrefix()}${rawText}`,
      indentLevel: getIndentLevel(toggleButton as HTMLElement),
    };
  }

  if (referenceNode) {
    const rawText = referenceNode.textContent?.trim() || "";
    const cleanText = rawText.replace(/👤/g, "").trim();
    const getPrefix = (): string => {
      if (isSuggestion) return "[S] ";
      if (isOtherUser) return "[O] ";
      return "";
    };
    return {
      element: referenceNode as HTMLElement,
      text: `${getPrefix()}${cleanText}`,
      indentLevel: getIndentLevel(referenceNode as HTMLElement),
    };
  }

  if (isSuggestion && innerNode) {
    /* eslint-disable testing-library/no-node-access */
    const textSpan = innerNode.querySelector(".break-word");
    /* eslint-enable testing-library/no-node-access */
    const rawText =
      textSpan?.textContent?.trim() || noteEditor?.textContent?.trim() || "";
    return {
      element: innerNode as HTMLElement,
      text: `[S] ${rawText}`,
      indentLevel: getIndentLevel(innerNode as HTMLElement),
    };
  }

  return null;
}

export async function getTreeStructure(): Promise<string> {
  await waitFor(() => {
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  /* eslint-disable testing-library/no-node-access */
  const allRows = document.querySelectorAll(".item");
  /* eslint-enable testing-library/no-node-access */

  const rowInfos: RowInfo[] = Array.from(allRows)
    .map((row) => classifyRow(row))
    .filter((info): info is RowInfo => info !== null);

  const lines = rowInfos.map(({ text, indentLevel }) => {
    const indent = "  ".repeat(indentLevel);
    return `${indent}${text}`;
  });

  return lines.join("\n");
}

/**
 * Asserts the tree matches the expected structure.
 * Pass a template string with 2-space indentation per level.
 */
export async function expectTree(expected: string): Promise<void> {
  const expectedNormalized = expected
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

  try {
    await waitFor(async () => {
      const actual = await getTreeStructure();
      expect(actual).toEqual(expectedNormalized);
    });
  } catch (error) {
    const actual = await getTreeStructure();
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
    <RootViewOrWorkspaceIsLoading>
      <WorkspaceView />
    </RootViewOrWorkspaceIsLoading>,
    user()
  );
}

/**
 * Creates a new node under "My Notes" and then changes the tree root to that node.
 * Returns with the new node as the root of the tree view.
 */
export async function createAndSetAsRoot(nodeName: string): Promise<void> {
  // First create the node under My Notes using keyboard
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), `${nodeName}{Escape}`);

  // Now use the pane search to change root to this node
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );

  // Type the node name and press Enter to submit search
  await userEvent.type(
    await screen.findByLabelText("search input"),
    `${nodeName}{Enter}`
  );

  // Click fullscreen button on the search result reference
  // The aria-label is "open X in fullscreen" where X is the reference display text
  await userEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`open.*${nodeName}.*in fullscreen`, "i"),
    })
  );

  // Wait for the tree to update with new root
  await waitFor(async () => {
    const tree = await getTreeStructure();
    expect(tree.startsWith(nodeName)).toBe(true);
  });
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
  // Wait for search results with references to load
  await waitFor(() => {
    const navigateButtons = screen.queryAllByRole("button", {
      name: new RegExp(`Navigate to.*${nodeName}`, "i"),
    });
    expect(navigateButtons.length).toBeGreaterThan(0);
  });
  // Click on the first reference to navigate (NodeAutoLink wraps refs in clickable button)
  // Use findAllByRole since there may be multiple references to the same node
  const navigateButtons = await screen.findAllByRole("button", {
    name: new RegExp(`Navigate to.*${nodeName}`, "i"),
  });
  await userEvent.click(navigateButtons[0]);
  // Wait for navigation to complete - look for expand/collapse button for the node
  // Use findAllByLabelText since multiple panes may have the same node
  await waitFor(() => {
    const buttons = screen.queryAllByLabelText(
      new RegExp(`(expand|collapse) ${nodeName}`)
    );
    expect(buttons.length).toBeGreaterThan(0);
  });
}

export {
  ALICE,
  UNAUTHENTICATED_BOB,
  UNAUTHENTICATED_CAROL,
  renderApp,
  mockRelayPool,
};
