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
import { WorkspaceView } from "./Workspace";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { DeleteWorkspace } from "./DeleteNode";
import { createSearchId } from "../connections";

export function PaneSearchButton(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
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
      setPane({ ...pane, stack: [searchId], author: user.publicKey, rootRelation: undefined });
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

  const paneIndex = usePaneIndex();
  return (
    <button
      type="button"
      className="split-pane-search btn btn-borderless"
      onClick={() => setShowInput(true)}
      aria-label={`Search to change pane ${paneIndex} content`}
      title="Search"
    >
      <span className="simple-icon-magnifier" />
    </button>
  );
}

export function ClosePaneButton(): JSX.Element | null {
  const { removePane, panes } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { createPlan, executePlan } = usePlanner();

  if (paneIndex === 0) {
    return null;
  }

  const handleRemovePane = (): void => {
    const plan = createPlan();
    const updatedViews = updateViewPathsAfterPaneDelete(plan.views, paneIndex);
    executePlan(planUpdateViews(plan, updatedViews));
    removePane(panes[paneIndex].id);
  };

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={handleRemovePane}
      aria-label="Close pane"
      title="Close pane"
    >
      <span className="btn-close small" />
    </button>
  );
}


export function PaneSettingsMenu(): JSX.Element {
  const navigate = useNavigate();
  const logout = useLogout();
  const { user } = useData();
  const isLoggedIn = isUserLoggedIn(user);

  return (
    <Dropdown className="options-dropdown">
      <Dropdown.Toggle
        as="button"
        className="btn"
        aria-label="open menu"
        tabIndex={0}
      >
        <span className="simple-icon-options-vertical" />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <DeleteWorkspace as="item" />
        <Dropdown.Item
          className="d-flex workspace-selection"
          onClick={() => navigate("/profile")}
          aria-label="show profile"
          tabIndex={0}
        >
          <span className="simple-icon-user d-block dropdown-item-icon" />
          <div className="workspace-selection-text">Profile</div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex workspace-selection"
          onClick={() => navigate("/follow")}
          aria-label="follow user"
          tabIndex={0}
        >
          <span className="simple-icon-user-follow d-block dropdown-item-icon" />
          <div className="workspace-selection-text">Follow User</div>
        </Dropdown.Item>
        <Dropdown.Item
          className="d-flex workspace-selection"
          onClick={() => navigate("/relays")}
          aria-label="edit relays"
          tabIndex={0}
        >
          <span className="icon-nostr-logo d-block dropdown-item-icon" />
          <div className="workspace-selection-text">Relays</div>
        </Dropdown.Item>
        {isLoggedIn && (
          <Dropdown.Item
            className="d-flex workspace-selection"
            onClick={logout}
            aria-label="logout"
            tabIndex={0}
          >
            <span className="simple-icon-logout d-block dropdown-item-icon" />
            <div className="workspace-selection-text">Log Out</div>
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
  const rootNodeID = pane.stack[pane.stack.length - 1];
  const isOtherUserContent = pane.author !== user.publicKey;
  console.log("PaneContent render", { paneIndex, paneId: pane.id, rootNodeID, stack: pane.stack });

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
              <WorkspaceView />
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
        <PaneWrapper key={pane.id} index={index} />
      ))}
    </div>
  );
}
