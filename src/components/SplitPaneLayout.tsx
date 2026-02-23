import React, { useState, useRef, useEffect, useCallback } from "react";
import { Dropdown } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import {
  useSplitPanes,
  PaneIndexProvider,
  usePaneIndex,
  useCurrentPane,
  generatePaneId,
} from "../SplitPanesContext";
import {
  RootViewContextProvider,
  updateViewPathsAfterPaneDelete,
} from "../ViewContext";
import { LoadData, LoadRelationData } from "../dataQuery";
import { LoadSearchData } from "../LoadSearchData";
import { PaneView } from "./Workspace";
import { EMPTY_NODE_ID, createSearchId, LOG_NODE_ID } from "../connections";
import { planUpdateViews, planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { useDragAutoScroll } from "../useDragAutoScroll";

export function PaneSearchButton(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const { user } = useData();
  const [showInput, setShowInput] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleSubmit = (): void => {
    if (query.trim()) {
      const searchId = createSearchId(query.trim());
      setPane({
        ...pane,
        stack: [searchId],
        author: user.publicKey,
        rootRelation: undefined,
      });
      setShowInput(false);
      setQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setShowInput(false);
      setQuery("");
    }
  };

  if (showInput) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="search-input-inline"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setShowInput(false);
          setQuery("");
        }}
        aria-label="search input"
      />
    );
  }

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={() => setShowInput(true)}
      data-pane-action="search"
      aria-label={`Search to change pane ${paneIndex} content`}
      title="Search"
    >
      <span aria-hidden="true">🔍</span>
    </button>
  );
}

export function ClosePaneButton(): JSX.Element {
  const { panes } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { createPlan, executePlan } = usePlanner();
  const { user } = useData();

  const handleRemovePane = (): void => {
    const plan = createPlan();
    if (panes.length <= 1) {
      const freshPane: Pane = {
        id: generatePaneId(),
        stack: [],
        author: user.publicKey,
      };
      executePlan(planUpdatePanes(plan, [freshPane]));
      return;
    }
    const updatedViews = updateViewPathsAfterPaneDelete(plan.views, paneIndex);
    const newPanes = panes.filter((p) => p.id !== panes[paneIndex].id);
    const planWithViews = planUpdateViews(plan, updatedViews);
    executePlan(planUpdatePanes(planWithViews, newPanes));
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleRemovePane}
      data-pane-action="close-pane"
      aria-label="Close pane"
      title="Close pane"
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

type CopiedField = "none" | "npub" | "nprofile" | "invite";

export function PaneSettingsMenu({
  onShowShortcuts,
}: {
  onShowShortcuts?: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const logout = useLogout();
  const { user } = useData();
  const isLoggedIn = isUserLoggedIn(user);
  const [copied, setCopied] = useState<CopiedField>("none");

  const copyToClipboard = (text: string, field: CopiedField): void => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied("none"), 1500);
  };

  const npub = isLoggedIn ? nip19.npubEncode(user.publicKey) : "";
  const nprofile = isLoggedIn
    ? nip19.nprofileEncode({ pubkey: user.publicKey })
    : "";
  const inviteLink = isLoggedIn
    ? `${window.location.origin}/follow?publicKey=${user.publicKey}`
    : "";

  return (
    <Dropdown className="options-dropdown status-dropdown">
      <Dropdown.Toggle
        as="button"
        className="status-btn"
        aria-label="open menu"
        tabIndex={0}
      >
        ≡
      </Dropdown.Toggle>
      <Dropdown.Menu>
        {isLoggedIn && (
          <>
            <Dropdown.Item
              className="d-flex menu-item"
              onClick={() => copyToClipboard(npub, "npub")}
              aria-label="copy npub"
              tabIndex={0}
            >
              <span className="d-block dropdown-item-icon" aria-hidden="true">
                @
              </span>
              <div className="menu-item-text">
                {copied === "npub" ? "Copied!" : "Copy npub"}
              </div>
            </Dropdown.Item>
            <Dropdown.Item
              className="d-flex menu-item"
              onClick={() => copyToClipboard(nprofile, "nprofile")}
              aria-label="copy nprofile"
              tabIndex={0}
            >
              <span className="d-block dropdown-item-icon" aria-hidden="true">
                @
              </span>
              <div className="menu-item-text">
                {copied === "nprofile" ? "Copied!" : "Copy nprofile"}
              </div>
            </Dropdown.Item>
            <Dropdown.Item
              className="d-flex menu-item"
              onClick={() => copyToClipboard(inviteLink, "invite")}
              aria-label="copy invite link"
              tabIndex={0}
            >
              <span className="d-block dropdown-item-icon" aria-hidden="true">
                @
              </span>
              <div className="menu-item-text">
                {copied === "invite" ? "Copied!" : "Copy invite link"}
              </div>
            </Dropdown.Item>
            <Dropdown.Divider />
          </>
        )}
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => navigate("/follow")}
          aria-label="follow user"
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            +@
          </span>
          <div className="menu-item-text">Follow User</div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => navigate("/relays")}
          aria-label="edit relays"
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            ~
          </span>
          <div className="menu-item-text">Relays</div>
        </Dropdown.Item>
        {onShowShortcuts && (
          <Dropdown.Item
            className="d-flex menu-item"
            onClick={onShowShortcuts}
            aria-label="keyboard shortcuts"
            tabIndex={0}
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              ?
            </span>
            <div className="menu-item-text">Shortcuts</div>
          </Dropdown.Item>
        )}
        {isLoggedIn && (
          <Dropdown.Item
            className="d-flex menu-item"
            onClick={logout}
            aria-label="logout"
            tabIndex={0}
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              q
            </span>
            <div className="menu-item-text">Log Out</div>
          </Dropdown.Item>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
}

function PaneContent(): JSX.Element {
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const { user } = useData();
  const rootNodeID = pane.stack[pane.stack.length - 1] || EMPTY_NODE_ID;

  const isOtherUserContent = pane.author !== user.publicKey;

  const paneClassName = isOtherUserContent
    ? "split-pane other-user-pane"
    : "split-pane";

  const content = (
    <div className={paneClassName} data-pane-index={paneIndex}>
      <LoadSearchData nodeIDs={pane.stack}>
        <LoadData nodeIDs={pane.stack}>
          <LoadData nodeIDs={[LOG_NODE_ID]} lists>
            <LoadData nodeIDs={[rootNodeID]} descendants referencedBy lists>
              <RootViewContextProvider
                root={rootNodeID as LongID}
                paneIndex={paneIndex}
              >
                <PaneView />
              </RootViewContextProvider>
            </LoadData>
          </LoadData>
        </LoadData>
      </LoadSearchData>
    </div>
  );

  if (pane.rootRelation) {
    return (
      <LoadRelationData relationID={pane.rootRelation}>
        {content}
      </LoadRelationData>
    );
  }
  return content;
}

function PaneWrapper({ index }: { index: number }): JSX.Element {
  return (
    <PaneIndexProvider index={index}>
      <PaneContent />
    </PaneIndexProvider>
  );
}

export function SplitPaneLayout(): JSX.Element {
  const { panes } = useSplitPanes();
  const [container, setContainer] = useState<HTMLElement | undefined>(
    undefined
  );
  const containerCallback = useCallback((el: HTMLDivElement | null) => {
    setContainer(el ?? undefined);
  }, []);

  useDragAutoScroll(container, "horizontal");

  return (
    <div className="split-pane-container" ref={containerCallback}>
      {panes.map((pane, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <PaneWrapper key={`${pane.id}-${index}`} index={index} />
      ))}
    </div>
  );
}
