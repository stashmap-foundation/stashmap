import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "react-responsive";
import { Dropdown } from "react-bootstrap";
import { List, OrderedSet } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { isUserLoggedIn } from "../NostrAuthContext";
import { useUserRelayContext } from "../UserRelayContext";
import { useBackend } from "../BackendContext";
import { getWriteRelays } from "../relayUtils";
import { ASSET_ENTITY_RELAY, DEFAULT_RELAYS } from "../nostr";
import { depositEntityTags, hasAssetEntityTag } from "../nodesDocumentEvent";
import { publishStateOf, type PublishState } from "../core/knowstrFrontmatter";
import { getNodeDocumentId, planSetDocumentPublishState } from "../core/plan";
import { documentEntityTags } from "./publishReach";
import { TemporaryViewProvider, useTemporaryView } from "./temporaryViewState";

import { getDisplayTextForRow, getIndependentRows } from "../rowModel";
import { useData } from "../DataContext";
import {
  useCurrentPane,
  usePaneIndex,
  useNavigatePane,
  useSplitPanes,
} from "../SplitPanesContext";
import { useNavigationState } from "../NavigationStateContext";
import { usePaneHistory } from "../PaneHistoryContext";
import {
  PaneTreeResultProvider,
  TreeView,
  usePaneTreeResult,
} from "./TreeView";
import { DroppableContainer } from "./DroppableContainer";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import {
  InlineFilterDots,
  FilterId,
  useToggleFilter,
} from "./TypeFilterButton";
import { NewPaneButton } from "./OpenInSplitPaneButton";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import {
  usePlanner,
  planForkPane,
  planRetractDocument,
  planClearTemporarySelection,
  planSetEmptyNodePosition,
  planSelectAllTemporaryRows,
  planShiftTemporarySelection,
  planToggleTemporarySelection,
} from "../planner";
import { parseTextToTrees, planPasteMarkdownTrees } from "./FileDropZone";
import { getNodeText, getSemanticID } from "../core/connections";
import { getOwnLogRoot } from "../core/systemRoots";
import {
  addressForSource,
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  buildShareRouteUrl,
} from "../navigationUrl";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
} from "../core/graphLookup";
import {
  documentDisplayName,
  getDocumentByIdOrFilePath,
  getDocumentForNode,
  type Document,
} from "../core/Document";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import {
  focusRow,
  getFocusableRows,
  getRowDepth,
  getRowFromElement,
  getRowKey,
  getScrollToRow,
  isEditableElement,
} from "./keyboardNavigation";
import {
  getVisibleParentRow,
  planBatchRelevance,
  planBatchArgument,
  planBatchIndent,
  planBatchOutdent,
} from "./batchOperations";
import { planDeleteNode } from "../treeMutations";
import { IS_MOBILE } from "./responsive";
import { MobileActionBar } from "./MobileActionBar";
import { isBlockLinkAny, nodeText } from "../core/nodeSpans";

function BreadcrumbItem({
  label,
  href,
  onClick,
  isLast,
  isSource = false,
  disabled = false,
}: {
  label: string;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  isLast: boolean;
  isSource?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const className = [
    isLast ? "breadcrumb-current" : "breadcrumb-link",
    isSource ? "breadcrumb-source" : "",
    disabled ? "breadcrumb-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (isLast) {
    return <span className={className}>{label}</span>;
  }

  if (!href || !onClick || disabled) {
    return (
      <>
        <span className={className}>{label}</span>
        <span className="breadcrumb-separator">/</span>
      </>
    );
  }

  return (
    <>
      <a
        href={href}
        className={className}
        onClick={onClick}
        aria-label={`Navigate to ${label}`}
      >
        {label}
      </a>
      <span className="breadcrumb-separator">/</span>
    </>
  );
}

type BreadcrumbTarget = {
  sourceId: SourceId;
  documentId?: string;
  rootNodeId?: ID;
  scrollToId?: string;
};

type BreadcrumbEntry = {
  key: string;
  label: string;
  target?: BreadcrumbTarget;
  isSource?: boolean;
  disabled?: boolean;
};

function getBreadcrumbLabel(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): string {
  return (
    getNodeText(node) || getSemanticID(knowledgeDBs, node, sourceId) || "..."
  );
}

function createDocumentBreadcrumbEntry(document: Document): BreadcrumbEntry {
  return {
    key: `document:${document.sourceId}:${document.docId}`,
    label: documentDisplayName(document),
    target: {
      sourceId: document.sourceId,
      documentId: document.docId,
    },
  };
}

function breadcrumbEntriesWithDocument(
  document: Document | undefined,
  nodeEntries: BreadcrumbEntry[]
): BreadcrumbEntry[] {
  if (!document) {
    return nodeEntries;
  }
  const documentEntry = createDocumentBreadcrumbEntry(document);
  const firstNodeEntry = nodeEntries[0];
  const visibleNodeEntries =
    firstNodeEntry?.label === documentEntry.label
      ? nodeEntries.slice(1)
      : nodeEntries;
  return [documentEntry, ...visibleNodeEntries];
}

function createNodeBreadcrumbEntry(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): BreadcrumbEntry {
  return {
    key: `node:${sourceId}:${node.id}`,
    label: getBreadcrumbLabel(knowledgeDBs, node, sourceId),
    target: {
      sourceId,
      rootNodeId: node.id,
    },
  };
}

function buildAnchoredLineageEntries(
  data: Data,
  graph: ReturnType<typeof graphLookupFromData>,
  node: GraphNode,
  sourceId: SourceId,
  seen = new Set<string>()
): BreadcrumbEntry[] {
  const seenKey = `${sourceId}:${node.id}`;
  if (seen.has(seenKey)) {
    return [createNodeBreadcrumbEntry(data.knowledgeDBs, node, sourceId)];
  }

  const nextSeen = new Set(seen).add(seenKey);
  if (node.parent) {
    const parentNode = getNodeInSource(graph, {
      sourceId,
      id: node.parent,
    })?.node;
    if (parentNode) {
      return [
        ...buildAnchoredLineageEntries(
          data,
          graph,
          parentNode,
          sourceId,
          nextSeen
        ),
        createNodeBreadcrumbEntry(data.knowledgeDBs, node, sourceId),
      ];
    }
  }

  return [createNodeBreadcrumbEntry(data.knowledgeDBs, node, sourceId)];
}

function Breadcrumbs(): JSX.Element {
  const data = useData();
  const pane = useCurrentPane();
  const navigatePane = useNavigatePane();
  const { setPane } = useSplitPanes();
  const paneHistory = usePaneHistory();
  const graph = graphLookupFromData(data);
  const rootNode = pane.rootNodeId
    ? lookupNode(graph, pane.rootNodeId, pane.sourceId)?.node
    : undefined;
  const paneDocument = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        pane.sourceId,
        pane.documentId
      )
    : undefined;
  const document =
    paneDocument ??
    (rootNode
      ? getDocumentForNode(
          data.knowledgeDBs,
          data.documents,
          rootNode,
          pane.sourceId
        )
      : undefined);
  const nodeEntries: BreadcrumbEntry[] = rootNode
    ? buildAnchoredLineageEntries(data, graph, rootNode, pane.sourceId)
    : [];
  const entries = breadcrumbEntriesWithDocument(document, nodeEntries);

  return (
    <nav className="breadcrumbs" aria-label="Navigation breadcrumbs">
      {entries.map((entry, index) => {
        const { target } = entry;
        const targetUrl = (() => {
          if (target?.documentId) {
            return buildDocumentRouteUrl(
              target.sourceId,
              target.documentId,
              target.scrollToId
            );
          }
          if (target?.rootNodeId) {
            return buildNodeRouteUrl(
              target.rootNodeId,
              target.sourceId,
              target.scrollToId
            );
          }
          return undefined;
        })();
        const onClick = target
          ? (e: React.MouseEvent): void => {
              e.preventDefault();
              paneHistory?.push(pane.id, pane);
              if (target.documentId) {
                setPane({
                  ...pane,
                  sourceId: target.sourceId,
                  documentId: target.documentId,
                  rootNodeId: undefined,
                  searchQuery: undefined,
                  searchResultIDs: undefined,
                  scrollToId: target.scrollToId,
                });
                return;
              }
              if (target.rootNodeId) {
                setPane({
                  ...pane,
                  sourceId: target.sourceId,
                  documentId: undefined,
                  rootNodeId: target.rootNodeId,
                  searchQuery: undefined,
                  searchResultIDs: undefined,
                  scrollToId: target.scrollToId,
                });
                return;
              }
              navigatePane(targetUrl || "#");
            }
          : undefined;
        return (
          <BreadcrumbItem
            key={entry.key}
            label={entry.label}
            href={targetUrl}
            onClick={onClick}
            isLast={index === entries.length - 1}
            isSource={entry.isSource}
            disabled={entry.disabled}
          />
        );
      })}
    </nav>
  );
}

function ForkButton(): JSX.Element | null {
  const isMobile = useMediaQuery(IS_MOBILE);
  const data = useData();
  const currentPane = useCurrentPane();
  const isViewingOtherUserContent = currentPane.sourceId !== LOCAL;
  const graph = graphLookupFromData(data);
  const currentNode = currentPane.rootNodeId
    ? lookupNode(graph, currentPane.rootNodeId, currentPane.sourceId)?.node
    : undefined;
  const paneIndex = usePaneIndex();
  const navigatePane = useNavigatePane();
  const { createPlan, executePlan } = usePlanner();

  if (!isViewingOtherUserContent) {
    return null;
  }

  const rootNodeId = currentPane.rootNodeId || currentNode?.root;
  const isAtRoot = !!currentNode && currentNode.id === rootNodeId;

  if (!rootNodeId) {
    return null;
  }

  const handleFork = (): void => {
    if (!currentNode) {
      return;
    }
    const plan = planForkPane(
      createPlan(),
      paneIndex,
      currentPane,
      currentNode
    );
    executePlan(plan);
  };

  if (!isAtRoot) {
    const href = buildNodeRouteUrl(rootNodeId, currentPane.sourceId);
    return (
      <a
        href={href}
        className="header-action-btn"
        onClick={(e) => {
          e.preventDefault();
          navigatePane(href);
        }}
        aria-label="Open root to make a copy"
      >
        {isMobile ? "copy" : "open root to copy"}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="header-action-btn"
      onClick={handleFork}
      aria-label="copy root to edit"
    >
      {isMobile ? "copy" : "copy to edit"}
    </button>
  );
}

function HomeButton(): JSX.Element | null {
  const { knowledgeDBs } = useData();
  const navigatePane = useNavigatePane();
  const logNode = getOwnLogRoot(knowledgeDBs);
  if (!logNode) {
    return null;
  }
  const href = buildNodeRouteUrl(logNode.id, LOCAL);

  return (
    <a
      href={href}
      className="btn btn-icon"
      onClick={(e) => {
        e.preventDefault();
        navigatePane(href);
      }}
      data-pane-action="home"
      aria-label="Navigate to Log"
      title="Log"
    >
      <span aria-hidden="true">✽</span>
    </a>
  );
}

function NewNoteButton(): JSX.Element {
  const navigatePane = useNavigatePane();

  return (
    <a
      href="/"
      className="btn btn-sm"
      onClick={(e) => {
        e.preventDefault();
        navigatePane("/");
      }}
      data-pane-action="new-note"
      aria-label="Create new note"
    >
      New
    </a>
  );
}

function useHomeShortcut(): void {
  const { knowledgeDBs } = useData();
  const navigatePane = useNavigatePane();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        const logNode = getOwnLogRoot(knowledgeDBs);
        if (!logNode) {
          return;
        }
        const href = buildNodeRouteUrl(logNode.id, LOCAL);
        e.preventDefault();
        navigatePane(href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigatePane, knowledgeDBs]);
}

function BackButton(): JSX.Element | null {
  const pane = useCurrentPane();
  const { setPane } = useSplitPanes();
  const paneHistory = usePaneHistory();
  const { replaceNextNavigation } = useNavigationState();

  if (!paneHistory?.canGoBack(pane.id)) {
    return null;
  }

  const handleBack = (): void => {
    const previous = paneHistory?.pop(pane.id);
    if (previous) {
      replaceNextNavigation();
      setPane(previous);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleBack}
      data-pane-action="back"
      aria-label="Go back"
      title="Back"
    >
      <span aria-hidden="true">&larr;</span>
    </button>
  );
}

// Destinations render as plain hostnames: a user shouldn't need to know
// what a relay or a wss:// URL is. The full URL stays in the tooltip.
function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// The header chip states the document's audience — "who can open this" —
// never a verb: private / everyone · N relays / paused. The popover is the
// audience ladder: only me (the default), a secret link (the capability:
// the per-document storage key in the URL fragment), everyone (publish).
// No dialogs. The relay list shows the EFFECTIVE set — the per-document
// choice when one exists, else the user's configured write relays (which
// fall back to the defaults) — and toggling a relay materializes the
// per-document override in knowstr_publish.relays.
// Shown only on own documents; foreign panes get the fork button instead.
function AudienceChip(): JSX.Element | null {
  const data = useData();
  const currentPane = useCurrentPane();
  const { createPlan, executePlan } = usePlanner();
  const { userRelays } = useUserRelayContext();
  const [destinationDraft, setDestinationDraft] = useState("");

  const isOwnContent = currentPane.sourceId === LOCAL;
  const graph = graphLookupFromData(data);
  const rootNode = currentPane.rootNodeId
    ? lookupNode(graph, currentPane.rootNodeId, currentPane.sourceId)?.node
    : undefined;
  const docId =
    currentPane.documentId ??
    (rootNode
      ? getNodeDocumentId({ knowledgeDBs: data.knowledgeDBs }, rootNode)
      : undefined);
  const document = docId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        LOCAL,
        docId
      )
    : undefined;

  if (!isOwnContent || !isUserLoggedIn(data.user) || !document) {
    return null;
  }

  const state = publishStateOf(document.frontMatter);
  const configured = getWriteRelays(userRelays).map((relay) => relay.url);
  // A user should never have to know what a relay is: with nothing
  // configured, the predefined set is offered and used. Documents
  // published under an asset: entity default to the asset relay only
  // (the v0 cheat), matching depositWriteRelayConf.
  const configuredOrDefault =
    configured.length > 0
      ? configured
      : getWriteRelays(DEFAULT_RELAYS).map((relay) => relay.url);
  const hasAssetEntity = hasAssetEntityTag(depositEntityTags(document));
  const baseline = hasAssetEntity ? [ASSET_ENTITY_RELAY] : configuredOrDefault;
  const declared = state?.relays;
  const effective = declared !== undefined ? declared : baseline;

  const applyState = (next: PublishState): void => {
    executePlan(
      planSetDocumentPublishState(createPlan(), document.docId, next)
    );
  };

  const applyRelays = (nextEffective: string[]): void => {
    if (!state) {
      return;
    }
    const sameAsBaseline =
      nextEffective.length === baseline.length &&
      baseline.every((url) => nextEffective.includes(url));
    applyState({
      ...state,
      relays: sameAsBaseline ? undefined : nextEffective,
    });
  };

  const handlePublish = (): void => {
    applyState({
      entities: [
        ...new Set([
          ...(state?.entities ?? []),
          ...documentEntityTags(data.knowledgeDBs, document),
        ]),
      ],
      relays: state?.relays,
      paused: false,
    });
  };

  // The capability a share link carries: the document's storage key in the
  // URL fragment — readable by anyone handed the link, discoverable by no
  // one. The key exists once the document has ridden a storage event.
  const { storageKey } = document;
  const authorAddress = addressForSource(LOCAL, data.user.publicKey);
  const secretLinkItem = storageKey !== undefined &&
    authorAddress !== undefined && (
      <Dropdown.Item
        className="d-flex menu-item"
        onClick={() => {
          const url = buildShareRouteUrl(
            authorAddress,
            document.docId,
            storageKey
          );
          // eslint-disable-next-line no-void
          void navigator.clipboard.writeText(`${window.location.origin}${url}`);
        }}
        aria-label="copy secret link"
        title="Anyone with the link can open this document"
        tabIndex={0}
      >
        <span className="d-block dropdown-item-icon" aria-hidden="true">
          🔗
        </span>
        <div className="menu-item-text">Copy secret link</div>
      </Dropdown.Item>
    );

  if (!state) {
    return (
      <Dropdown className="options-dropdown publish-dropdown">
        <Dropdown.Toggle
          as="button"
          className="header-action-btn"
          aria-label="audience options"
          title="Only you can open this document"
          tabIndex={0}
        >
          ○ private
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item
            className="d-flex menu-item"
            aria-label="only me"
            title="Encrypted — only you can open this document"
            disabled
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              ●
            </span>
            <div className="menu-item-text">Only me — encrypted</div>
          </Dropdown.Item>
          {secretLinkItem}
          <Dropdown.Item
            className="d-flex menu-item"
            onClick={handlePublish}
            aria-label="publish document"
            title={`Publish this document to ${effective.length} relays — visible to everyone`}
            tabIndex={0}
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              ○
            </span>
            <div className="menu-item-text">
              Everyone · {effective.length} relays
            </div>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    );
  }

  const relayRows = [
    ...new Set([...baseline, ...configuredOrDefault, ...(declared ?? [])]),
  ];
  return (
    // autoClose="outside": toggling destinations and entities is an
    // editing session — the menu closes on outside click, not per click.
    <Dropdown className="options-dropdown publish-dropdown" autoClose="outside">
      <Dropdown.Toggle
        as="button"
        className="header-action-btn"
        aria-label="audience options"
        title={
          state.paused
            ? "Paused — the last published version stays visible"
            : `Published — republishes on every save${
                effective.length === 0 ? " (no destinations selected)" : ""
              }`
        }
        tabIndex={0}
      >
        {state.paused ? "◌ paused" : `⦿ everyone · ${effective.length} relays`}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        {secretLinkItem}
        {secretLinkItem && <Dropdown.Divider />}
        {state.entities.map((entity) => (
          <Dropdown.Item
            key={entity}
            className="d-flex menu-item"
            onClick={() =>
              applyState({
                ...state,
                entities: state.entities.filter((e) => e !== entity),
              })
            }
            aria-label={`stop publishing under ${entity}`}
            title={`Stop publishing under ${entity}`}
            tabIndex={0}
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              ×
            </span>
            <div className="menu-item-text">{entity}</div>
          </Dropdown.Item>
        ))}
        {state.entities.length > 0 && <Dropdown.Divider />}
        {relayRows.map((url) => {
          const active = effective.includes(url);
          return (
            <Dropdown.Item
              key={url}
              className={`d-flex menu-item${
                active ? "" : " publish-destination-off"
              }`}
              onClick={() =>
                applyRelays(
                  active
                    ? effective.filter((u) => u !== url)
                    : [...effective, url]
                )
              }
              aria-label={`${active ? "deselect" : "select"} relay ${url}`}
              title={url}
              tabIndex={0}
            >
              <span className="d-block dropdown-item-icon" aria-hidden="true">
                {active ? "✓" : "○"}
              </span>
              <div className="menu-item-text">{hostLabel(url)}</div>
            </Dropdown.Item>
          );
        })}
        <form
          className="d-flex menu-item publish-add-destination"
          onSubmit={(event) => {
            event.preventDefault();
            const draft = destinationDraft.trim();
            if (draft !== "") {
              const url = draft.includes("://") ? draft : `wss://${draft}`;
              applyRelays([...new Set([...effective, url])]);
              setDestinationDraft("");
            }
          }}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            +
          </span>
          <input
            className="publish-add-input"
            type="text"
            value={destinationDraft}
            placeholder="add your own…"
            aria-label="add destination"
            onChange={(event) => setDestinationDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
          />
        </form>
        <Dropdown.Divider />
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => applyState({ ...state, paused: !state.paused })}
          aria-label={state.paused ? "resume publishing" : "pause publishing"}
          title={
            state.paused
              ? "Resume — republishes on every save"
              : "Pause — the last published version stays visible"
          }
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            {state.paused ? "▶" : "⏸"}
          </span>
          <div className="menu-item-text">
            {state.paused ? "Resume publishing" : "Pause publishing"}
          </div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() =>
            executePlan(planRetractDocument(createPlan(), document))
          }
          aria-label="stop publishing"
          title="Retracts it from the relays — copies others made remain theirs"
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            ⏏
          </span>
          <div className="menu-item-text">Stop publishing</div>
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

function PaneHeader(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;
  useHomeShortcut();

  return (
    <header className="pane-header">
      <div className="pane-header-left">
        <BackButton />
        <Breadcrumbs />
        <AudienceChip />
        <ForkButton />
        {isFirstPane && <SignInMenuBtn />}
      </div>
      <div className="pane-header-right">
        <HomeButton />
        <NewNoteButton />
        <InlineFilterDots />
        <PaneSearchButton />
        <NewPaneButton />
        <ClosePaneButton />
      </div>
    </header>
  );
}

function CurrentNodeName(): JSX.Element {
  const data = useData();
  const pane = useCurrentPane();
  const document = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        pane.sourceId,
        pane.documentId
      )
    : undefined;
  const graph = graphLookupFromData(data);
  const rootNode = pane.rootNodeId
    ? lookupNode(graph, pane.rootNodeId, pane.sourceId)?.node
    : undefined;
  const displayName = (() => {
    if (document) {
      return documentDisplayName(document);
    }
    if (rootNode) {
      return nodeText(rootNode);
    }
    return "";
  })();

  if (!displayName) {
    return <span>New Note</span>;
  }

  const truncated =
    displayName.length > 20 ? `${displayName.slice(0, 20)}…` : displayName;

  return <span>{truncated}</span>;
}

function PaneStatusLine({
  onShowShortcuts,
}: {
  onShowShortcuts?: () => void;
}): JSX.Element {
  const paneIndex = usePaneIndex();
  const pane = useCurrentPane();
  const { workspace } = useBackend();
  const isFirstPane = paneIndex === 0;
  const isViewingOtherUserContent = pane.sourceId !== LOCAL;

  return (
    <footer className="pane-status-line">
      <div className="status-segment">
        <CurrentNodeName />
      </div>
      <div
        className={`status-spacer ${
          isViewingOtherUserContent ? "status-readonly" : ""
        }`}
      >
        {isViewingOtherUserContent && "READONLY"}
      </div>
      {/* The relays/synced status tracks the web storage channel. The
          desktop workspace is the disk — there is nothing to sync. */}
      {isFirstPane && !workspace && <PublishingStatusWrapper />}
      {isFirstPane && (
        <div className="status-segment">
          <PaneSettingsMenu onShowShortcuts={onShowShortcuts} />
        </div>
      )}
    </footer>
  );
}

const KEY_TO_FILTER: Record<string, FilterId> = {
  "1": "relevant",
  "!": "relevant",
  "2": "maybe_relevant",
  "?": "maybe_relevant",
  "3": "little_relevant",
  "~": "little_relevant",
  "4": "not_relevant",
  x: "not_relevant",
  "5": "contains",
  o: "contains",
  "8": "suggestions",
  "@": "suggestions",
  "9": "versions",
  "0": "incoming",
};

export function getActiveRow(root: HTMLElement): HTMLElement | undefined {
  const rows = getFocusableRows(root);
  return rows.find((row) => row.tabIndex === 0);
}

function scrollAndFocusRow(root: HTMLElement, index: number): void {
  const target = root.querySelector(
    `[data-row-focusable="true"][data-row-index="${index}"]`
  );
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ block: "nearest" });
    focusRow(target);
    return;
  }
  const scrollToRow = getScrollToRow(root);
  if (scrollToRow) {
    scrollToRow(index, () => {
      const retryTarget = root.querySelector(
        `[data-row-focusable="true"][data-row-index="${index}"]`
      );
      if (retryTarget instanceof HTMLElement) {
        focusRow(retryTarget);
      }
    });
  }
}

function focusParentRow(root: HTMLElement, activeRow: HTMLElement): void {
  const rows = getFocusableRows(root);
  const activeIndex = rows.findIndex(
    (row) => getRowKey(row) === getRowKey(activeRow)
  );
  if (activeIndex <= 0) {
    return;
  }
  const activeDepth = getRowDepth(activeRow);
  const parent = rows
    .slice(0, activeIndex)
    .reverse()
    .find((row) => getRowDepth(row) < activeDepth);
  focusRow(parent);
}

function focusFirstChildRow(root: HTMLElement, activeRow: HTMLElement): void {
  const rows = getFocusableRows(root);
  const activeIndex = rows.findIndex(
    (row) => getRowKey(row) === getRowKey(activeRow)
  );
  if (activeIndex < 0 || activeIndex >= rows.length - 1) {
    return;
  }
  const activeDepth = getRowDepth(activeRow);
  const child = rows
    .slice(activeIndex + 1)
    .find((row) => getRowDepth(row) === activeDepth + 1);
  focusRow(child);
}

function focusRowEditor(activeRow: HTMLElement): boolean {
  const editor = activeRow.querySelector(
    '[role="textbox"][aria-label^="edit "], [role="textbox"][aria-label="new node editor"]'
  );
  if (editor instanceof HTMLElement) {
    editor.focus();
    if (
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement
    ) {
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
      return true;
    }
    if (editor.isContentEditable) {
      const selection = window.getSelection();
      if (!selection) {
        return true;
      }
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }
  return false;
}

function focusAdjacentRowEditor(
  root: HTMLElement,
  currentRow: HTMLElement,
  delta: -1 | 1
): void {
  const currentIndex = Number(currentRow.getAttribute("data-row-index") || "0");
  const targetIndex = currentIndex + delta;
  const target = root.querySelector(
    `[data-row-focusable="true"][data-row-index="${targetIndex}"]`
  );
  if (!(target instanceof HTMLElement)) {
    return;
  }
  target.scrollIntoView({ block: "nearest" });
  focusRow(target);
  focusRowEditor(target);
}

function toggleRowOpenInSplitPane(activeRow: HTMLElement): void {
  const button = activeRow.querySelector(
    '[data-node-action="open-split-pane"], button[aria-label="open in split pane"]'
  );
  if (button instanceof HTMLElement) {
    button.click();
  }
}

function toggleRowOpenFullscreen(activeRow: HTMLElement): void {
  const button = activeRow.querySelector(
    '[data-node-action="open-fullscreen"], button[aria-label*="in fullscreen"], button[aria-label="open fullscreen"]'
  );
  if (button instanceof HTMLElement) {
    button.click();
  }
}

function triggerPaneHome(root: HTMLElement): void {
  const homeButton = root.querySelector('[data-pane-action="home"]');
  if (homeButton instanceof HTMLElement) {
    homeButton.click();
  }
}

function getPaneWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".pane-wrapper")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
}

function getSelectedPaneRoot(): HTMLElement | null {
  return (
    getPaneWrappers().find(
      (pane) => pane.getAttribute("data-keyboard-pane-selected") === "true"
    ) || null
  );
}

function setSelectedPane(targetPane: HTMLElement): void {
  getPaneWrappers().forEach((pane) =>
    pane.removeAttribute("data-keyboard-pane-selected")
  );
  targetPane.setAttribute("data-keyboard-pane-selected", "true");
}

export const SYMBOL_TO_RELEVANCE: Record<string, Relevance> = {
  x: "not_relevant",
  "~": "little_relevant",
  "?": "maybe_relevant",
  "!": "relevant",
};

export function refocusPaneAfterRowMutation(root: HTMLElement): void {
  window.setTimeout(() => {
    const { activeElement } = document;
    if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
      return;
    }
    const activeRow = getActiveRow(root);
    if (activeRow) {
      focusRow(activeRow);
      return;
    }
    root.focus();
  }, 0);
}

function getSubtreeKeysFromRows(
  rows: List<Row>,
  activeRowKey: string
): string[] {
  const activeIndex = rows.findIndex((row) => row.viewKey === activeRowKey);
  if (activeIndex === -1) {
    return [activeRowKey];
  }
  const activeRow = rows.get(activeIndex);
  if (!activeRow) {
    return [activeRowKey];
  }
  const endIndex = rows
    .slice(activeIndex + 1)
    .findIndex((row) => row.depth <= activeRow.depth);
  const finalIndex = endIndex === -1 ? rows.size : activeIndex + 1 + endIndex;
  return rows
    .slice(activeIndex, finalIndex)
    .map((row) => row.viewKey)
    .toArray();
}

function computeFocusIndexAfterDeletion(
  keys: string[],
  rows: List<Row>
): number | undefined {
  const removedSet = new Set(
    keys.flatMap((key) => getSubtreeKeysFromRows(rows, key))
  );
  if (removedSet.size >= rows.size) {
    return undefined;
  }
  const orderedViewKeys = rows.map((row) => row.viewKey).toArray();
  const survivors = orderedViewKeys.filter((key) => !removedSet.has(key));
  const maxRemovedIndex = orderedViewKeys.reduce(
    (max, key, i) => (removedSet.has(key) ? Math.max(max, i) : max),
    -1
  );
  const firstSurvivorAfter = orderedViewKeys.findIndex(
    (key, i) => i > maxRemovedIndex && !removedSet.has(key)
  );
  if (firstSurvivorAfter !== -1) {
    return survivors.indexOf(orderedViewKeys[firstSurvivorAfter]);
  }
  return survivors.length - 1;
}

export function getActionTargetRows(
  selection: OrderedSet<string>,
  activeRow: HTMLElement,
  rows: List<Row>
): Row[] {
  const activeKey = getRowKey(activeRow);
  if (selection.size === 0) {
    return rows.filter((row) => row.viewKey === activeKey).toArray();
  }
  return rows.filter((row) => selection.contains(row.viewKey)).toArray();
}

function usePaneKeyboardNavigation(paneIndex: number): {
  wrapperRef: React.RefObject<HTMLDivElement>;
  onKeyDownCapture: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaneMouseEnter: () => void;
  onPaneFocusCapture: () => void;
  showShortcuts: boolean;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
} {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { setActivePaneIndex } = useNavigationState();
  const { selection, anchor } = useTemporaryView();
  const data = useData();
  const toggleFilter = useToggleFilter();
  const { createPlan, executePlan } = usePlanner();
  const treeResult = usePaneTreeResult();
  const rows = treeResult?.rows || List<Row>();
  const orderedViewKeys = useMemo(
    () => rows.map((row) => row.viewKey).toArray(),
    [rows]
  );

  const switchPane = (direction: -1 | 1): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }
    const allPanes = getPaneWrappers();
    const currentIndex = allPanes.findIndex((paneEl) => paneEl === root);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = Math.max(
      0,
      Math.min(allPanes.length - 1, currentIndex + direction)
    );
    if (targetIndex === currentIndex) {
      return;
    }
    const targetPane = allPanes[targetIndex];
    setSelectedPane(targetPane);
    targetPane.focus();
    setActivePaneIndex(targetIndex);
    const targetRow = getActiveRow(targetPane);
    if (targetRow) {
      focusRow(targetRow);
    }
  };

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) {
      return () => {};
    }
    if (paneIndex !== 0) {
      return () => {};
    }

    const selectedPane = getSelectedPaneRoot();
    if (!selectedPane) {
      setSelectedPane(root);
    }

    const { activeElement } = document;
    if (
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement ||
      !document.contains(activeElement)
    ) {
      root.focus();
    }
    return () => {};
  }, [paneIndex]);

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) {
      return () => {};
    }
    const onGlobalKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) {
        return;
      }
      if (showShortcuts) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "j" && e.key !== "Escape") {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (isEditableElement(e.target)) {
        return;
      }
      if (e.target instanceof HTMLElement && e.target.closest(".modal")) {
        return;
      }
      const selectedPane =
        getSelectedPaneRoot() || (paneIndex === 0 ? root : null);
      if (selectedPane !== root) {
        return;
      }
      const { activeElement } = document;
      if (
        activeElement instanceof HTMLElement &&
        root.contains(activeElement)
      ) {
        return;
      }
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        if (e.key === "ArrowDown" || e.key === "j") {
          const [firstRow] = getFocusableRows(root);
          if (firstRow) {
            e.preventDefault();
            focusRow(firstRow);
          }
        }
        return;
      }
      e.preventDefault();
      focusRow(activeRow);
    };
    window.addEventListener("keydown", onGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown, true);
    };
  }, [paneIndex, showShortcuts]);

  const onPaneMouseEnter = (): void => {
    if (!wrapperRef.current) {
      return;
    }
    setSelectedPane(wrapperRef.current);
    setActivePaneIndex(paneIndex);
  };

  const onPaneFocusCapture = (): void => {
    if (!wrapperRef.current) {
      return;
    }
    setSelectedPane(wrapperRef.current);
    setActivePaneIndex(paneIndex);
  };

  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }

    const now = Date.now();
    const lastSequenceKey = root.dataset.keyboardSequenceKey as
      | "g"
      | "d"
      | "f"
      | undefined;
    const lastSequenceTs = Number(root.dataset.keyboardSequenceTs || "0");
    const setLastSequence = (key: "g" | "d" | "f" | null, ts: number): void => {
      if (!key) {
        root.removeAttribute("data-keyboard-sequence-key");
        root.removeAttribute("data-keyboard-sequence-ts");
        return;
      }
      root.setAttribute("data-keyboard-sequence-key", key);
      root.setAttribute("data-keyboard-sequence-ts", String(ts));
    };
    const editable = isEditableElement(e.target);
    const focusedRow = getRowFromElement(document.activeElement);

    if (editable) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isMiniEditor =
        target?.classList.contains("mini-editor") ||
        target?.closest(".mini-editor") !== null;
      if (
        isMiniEditor &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        const currentRow = getRowFromElement(e.target);
        if (!currentRow) {
          return;
        }
        e.preventDefault();
        focusAdjacentRowEditor(
          root,
          currentRow,
          e.key === "ArrowDown" ? 1 : -1
        );
      }
      return;
    }

    if (showShortcuts && e.key === "Escape") {
      e.preventDefault();
      setShowShortcuts(false);
      return;
    }

    if (e.key === "F1" || ((e.metaKey || e.ctrlKey) && e.key === "/")) {
      e.preventDefault();
      setShowShortcuts(true);
      return;
    }

    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        root.focus();
        return;
      }
      const targetRows = getIndependentRows(
        getActionTargetRows(selection, activeRow, rows)
      );
      const plan = createPlan();
      const result = e.shiftKey
        ? planBatchOutdent(plan, targetRows, rows)
        : planBatchIndent(plan, targetRows, rows);
      if (result) {
        executePlan(result);
        refocusPaneAfterRowMutation(root);
      }
      return;
    }

    const isShiftOnly = e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (
      isShiftOnly &&
      e.key !== "!" &&
      e.key !== "?" &&
      e.key !== "~" &&
      e.key !== "+" &&
      e.key !== "-"
    ) {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      const activeRowKey = getRowKey(activeRow);
      const activeIndex = orderedViewKeys.indexOf(activeRowKey);
      if (activeIndex < 0) {
        return;
      }

      if (
        e.key === "J" ||
        e.key === "j" ||
        e.key === "ArrowDown" ||
        e.key === "K" ||
        e.key === "k" ||
        e.key === "ArrowUp"
      ) {
        e.preventDefault();
        const isDown = e.key === "J" || e.key === "j" || e.key === "ArrowDown";
        const targetIndex = isDown ? activeIndex + 1 : activeIndex - 1;
        const boundedTarget = Math.max(
          0,
          Math.min(orderedViewKeys.length - 1, targetIndex)
        );
        const targetKey = orderedViewKeys[boundedTarget];
        if (!targetKey) {
          return;
        }
        executePlan(
          planShiftTemporarySelection(
            createPlan(),
            orderedViewKeys,
            targetKey,
            activeRowKey
          )
        );
        if (boundedTarget !== activeIndex) {
          scrollAndFocusRow(root, boundedTarget);
        }
        return;
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      executePlan(
        planSelectAllTemporaryRows(createPlan(), orderedViewKeys, anchor)
      );
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      const selectedKeys =
        selection.size > 0
          ? orderedViewKeys.filter((viewKey) => selection.contains(viewKey))
          : getSubtreeKeysFromRows(rows, activeRowKey);
      if (selectedKeys.length === 0) {
        return;
      }
      const selectedRows = rows
        .filter((row) => selectedKeys.includes(row.viewKey))
        .toArray();
      const depths = selectedRows.map((row) => row.depth);
      const minDepth = Math.min(...depths);
      const lines = selectedRows.map((row) => {
        const depth = row.depth - minDepth;
        const text = getDisplayTextForRow(data, row);
        return "\t".repeat(depth) + text;
      });
      navigator.clipboard.writeText(lines.join("\n"));
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      const parentRow = rows.find((row) => row.viewKey === activeRowKey);
      if (!parentRow) {
        return;
      }
      navigator.clipboard.readText().then((text) => {
        const trees = parseTextToTrees(text);
        if (trees.length === 0) {
          return;
        }
        executePlan(
          planPasteMarkdownTrees(createPlan(), trees, parentRow.node, 0)
        );
      });
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      const searchButton = root.querySelector('[data-pane-action="search"]');
      if (searchButton instanceof HTMLElement) {
        searchButton.click();
      }
      return;
    }

    if (e.key === "N") {
      e.preventDefault();
      const newNoteButton = root.querySelector('[data-pane-action="new-note"]');
      if (newNoteButton instanceof HTMLElement) {
        window.setTimeout(() => newNoteButton.click(), 0);
      }
      return;
    }

    if (e.key === "P") {
      e.preventDefault();
      const newPaneButton = root.querySelector('[data-pane-action="new-pane"]');
      if (newPaneButton instanceof HTMLElement) {
        window.setTimeout(() => newPaneButton.click(), 0);
      }
      return;
    }

    if (e.key === "q") {
      e.preventDefault();
      const closePaneButton = root.querySelector(
        '[data-pane-action="close-pane"]'
      );
      if (closePaneButton instanceof HTMLElement) {
        closePaneButton.click();
      }
      return;
    }

    if (e.key === "]") {
      e.preventDefault();
      switchPane(1);
      return;
    }

    if (e.key === "[") {
      e.preventDefault();
      switchPane(-1);
      return;
    }

    if (e.key === "H") {
      e.preventDefault();
      triggerPaneHome(root);
      return;
    }

    const activeRow = getActiveRow(root);
    if (!activeRow) {
      return;
    }
    const activeIndex = Number(activeRow.getAttribute("data-row-index") || "0");

    if (e.key === "Escape") {
      e.preventDefault();
      if (selection.size > 0) {
        executePlan(planClearTemporarySelection(createPlan(), ""));
        return;
      }
      (document.activeElement as HTMLElement)?.blur();
      return;
    }

    if (e.key === "g") {
      if (lastSequenceKey === "g" && now - lastSequenceTs < 600) {
        e.preventDefault();
        scrollAndFocusRow(root, 0);
        setLastSequence(null, 0);
        return;
      }
      setLastSequence("g", now);
      return;
    }

    if (e.key === "f") {
      setLastSequence("f", now);
      return;
    }

    if (lastSequenceKey === "f" && now - lastSequenceTs < 800) {
      const filterId = KEY_TO_FILTER[e.key];
      if (filterId) {
        e.preventDefault();
        toggleFilter(filterId);
        setLastSequence(null, 0);
        return;
      }
    }

    setLastSequence(null, 0);

    if (e.key === "G") {
      e.preventDefault();
      const treeRoot = root.querySelector("[data-total-rows]");
      const totalRows = Number(
        treeRoot?.getAttribute("data-total-rows") || "0"
      );
      if (totalRows > 0) {
        scrollAndFocusRow(root, totalRows - 1);
      }
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      executePlan(planToggleTemporarySelection(createPlan(), activeRowKey));
      return;
    }

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      scrollAndFocusRow(root, activeIndex + 1);
      return;
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      scrollAndFocusRow(root, activeIndex - 1);
      return;
    }

    if (e.key === "h" || e.key === "ArrowLeft") {
      e.preventDefault();
      const collapseButton = activeRow.querySelector(
        "button[aria-label^='collapse ']"
      );
      if (collapseButton instanceof HTMLElement) {
        collapseButton.click();
      } else {
        focusParentRow(root, activeRow);
      }
      return;
    }

    if (e.key === "l" || e.key === "ArrowRight") {
      e.preventDefault();
      const expandButton = activeRow.querySelector(
        "button[aria-label^='expand ']"
      );
      if (expandButton instanceof HTMLElement) {
        expandButton.click();
        window.setTimeout(() => focusFirstChildRow(root, activeRow), 0);
      } else {
        focusFirstChildRow(root, activeRow);
      }
      return;
    }

    if (e.key === "Enter" || e.key === "i") {
      e.preventDefault();
      if (focusRowEditor(activeRow)) {
        return;
      }

      const activeRowKey = getRowKey(activeRow);
      const activeRowData = rows.find((row) => row.viewKey === activeRowKey);
      const activeGraphRow = activeRowData?.node;
      const parentRow = activeRowData
        ? getVisibleParentRow(rows, activeRowData)
        : undefined;
      const activeNodeIndex = activeRowData?.childIndex;
      if (
        isBlockLinkAny(activeGraphRow) &&
        parentRow &&
        activeNodeIndex !== undefined
      ) {
        executePlan(
          planSetEmptyNodePosition(
            createPlan(),
            parentRow.node.id,
            parentRow.view,
            parentRow.viewPath,
            paneIndex,
            activeNodeIndex + 1
          )
        );
      }
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      const targetRows = getIndependentRows(
        getActionTargetRows(selection, activeRow, rows)
      ).filter((row) => row.sourceId === LOCAL);
      const keys = targetRows.map((row) => row.viewKey);
      const focusIndex = computeFocusIndexAfterDeletion(keys, rows);
      const result = planClearTemporarySelection(
        targetRows.reduce(
          (acc, row) =>
            planDeleteNode(
              acc,
              row.node.id,
              row.rowID,
              row.parentNode?.id,
              paneIndex
            ),
          createPlan()
        )
      );
      executePlan(result);
      window.setTimeout(() => {
        if (focusIndex !== undefined) {
          scrollAndFocusRow(root, focusIndex);
        }
      }, 0);
      return;
    }

    if (e.key === "s") {
      e.preventDefault();
      toggleRowOpenInSplitPane(activeRow);
      return;
    }

    if (e.key === "z") {
      e.preventDefault();
      toggleRowOpenFullscreen(activeRow);
      return;
    }

    if (e.key === "x" || e.key === "~" || e.key === "!" || e.key === "?") {
      e.preventDefault();
      const plan = createPlan();
      const targetRows = getActionTargetRows(selection, activeRow, rows);
      const activeRowData = rows.find(
        (row) => row.viewKey === getRowKey(activeRow)
      );
      const targetRelevance = SYMBOL_TO_RELEVANCE[e.key];
      const relevance =
        activeRowData?.node.relevance === targetRelevance
          ? undefined
          : targetRelevance;
      executePlan(planBatchRelevance(plan, targetRows, relevance));
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (e.key === "+" || e.key === "-" || e.key === "o") {
      e.preventDefault();
      const plan = createPlan();
      const targetRows = getActionTargetRows(selection, activeRow, rows);
      const activeRowData = rows.find(
        (row) => row.viewKey === getRowKey(activeRow)
      );
      const targetArgument: Argument = (() => {
        if (e.key === "+") return "confirms" as const;
        if (e.key === "-") return "contra" as const;
        return undefined;
      })();
      const argument: Argument =
        activeRowData?.node.argument === targetArgument
          ? undefined
          : targetArgument;
      executePlan(planBatchArgument(plan, targetRows, argument));
      refocusPaneAfterRowMutation(root);
      return;
    }

    const filterId = KEY_TO_FILTER[e.key];
    if (filterId) {
      e.preventDefault();
      toggleFilter(filterId);
      // If the focused row was removed by the filter change, focus falls to
      // <body> and subsequent keypresses won't reach this handler. Recapture
      // focus on the pane wrapper so keyboard shortcuts keep working.
      window.setTimeout(() => {
        if (document.activeElement === document.body) {
          root.focus();
        }
      }, 0);
    }
  };

  return {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  };
}

function PaneViewInner(): JSX.Element {
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const isOtherUser = pane.sourceId !== LOCAL;
  const {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  } = usePaneKeyboardNavigation(paneIndex);

  return (
    <div
      ref={wrapperRef}
      className={`pane-wrapper ${isOtherUser ? "pane-other-user" : ""}`}
      tabIndex={-1}
      onMouseEnter={onPaneMouseEnter}
      onFocusCapture={onPaneFocusCapture}
      onKeyDownCapture={onKeyDownCapture}
    >
      <KeyboardShortcutsModal
        show={showShortcuts}
        onHide={() => setShowShortcuts(false)}
      />
      <PaneHeader />
      <DroppableContainer
        ariaLabel={`Pane ${paneIndex} content`}
        className={`pane-content${
          !pane.rootNodeId && !pane.documentId && !pane.searchQuery
            ? " empty-pane-drop-zone"
            : ""
        }`}
        disabled={!!pane.rootNodeId || !!pane.documentId || !!pane.searchQuery}
      >
        <TreeView />
      </DroppableContainer>
      <MobileActionBar wrapperRef={wrapperRef} />
      <PaneStatusLine onShowShortcuts={() => setShowShortcuts(true)} />
    </div>
  );
}

export function PaneView(): JSX.Element | null {
  return (
    <TemporaryViewProvider>
      <PaneTreeResultProvider>
        <PaneViewInner />
      </PaneTreeResultProvider>
    </TemporaryViewProvider>
  );
}
