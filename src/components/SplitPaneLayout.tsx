import React, { useState, useRef, useEffect } from "react";
import { Dropdown } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import {
  useSplitPanes,
  PaneIndexProvider,
  usePaneIndex,
  useCurrentPane,
} from "../SplitPanesContext";
import {
  RootViewContextProvider,
  updateViewPathsAfterPaneDelete,
} from "../ViewContext";
import { LoadData } from "../dataQuery";
import { LoadSearchData } from "../LoadSearchData";
import { PaneView } from "./Workspace";
import { EMPTY_NODE_ID } from "../connections";
import { planUpdateViews, planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { createSearchId } from "../connections";

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
      aria-label={`Search to change pane ${paneIndex} content`}
      title="Search"
    >
      <span aria-hidden="true">🔍</span>
    </button>
  );
}

export function ClosePaneButton(): JSX.Element | null {
  const { panes } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { createPlan, executePlan } = usePlanner();

  if (paneIndex === 0) {
    return null;
  }

  const handleRemovePane = (): void => {
    if (panes.length <= 1) {
      return;
    }
    const plan = createPlan();
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
      aria-label="Close pane"
      title="Close pane"
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

export function PaneSettingsMenu(): JSX.Element {
  const navigate = useNavigate();
  const logout = useLogout();
  const { user } = useData();
  const isLoggedIn = isUserLoggedIn(user);

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
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => navigate("/profile")}
          aria-label="show profile"
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            👤
          </span>
          <div className="menu-item-text">Profile</div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => navigate("/follow")}
          aria-label="follow user"
          tabIndex={0}
        >
          <span className="d-block dropdown-item-icon" aria-hidden="true">
            👥
          </span>
          <div className="menu-item-text">Follow User</div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex menu-item"
          onClick={() => navigate("/relays")}
          aria-label="edit relays"
          tabIndex={0}
        >
          <span className="icon-nostr-logo d-block dropdown-item-icon" />
          <div className="menu-item-text">Relays</div>
        </Dropdown.Item>
        {isLoggedIn && (
          <Dropdown.Item
            className="d-flex menu-item"
            onClick={logout}
            aria-label="logout"
            tabIndex={0}
          >
            <span className="d-block dropdown-item-icon" aria-hidden="true">
              ↪
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

  return (
    <div className={paneClassName}>
      <LoadSearchData nodeIDs={pane.stack}>
        <LoadData nodeIDs={pane.stack}>
          <LoadData nodeIDs={[rootNodeID]} descendants referencedBy lists>
            <RootViewContextProvider
              root={rootNodeID as LongID}
              paneIndex={paneIndex}
            >
              <PaneView />
            </RootViewContextProvider>
          </LoadData>
        </LoadData>
      </LoadSearchData>
    </div>
  );
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

  return (
    <div className="split-pane-container">
      {panes.map((pane, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <PaneWrapper key={`${pane.id}-${index}`} index={index} />
      ))}
    </div>
  );
}
