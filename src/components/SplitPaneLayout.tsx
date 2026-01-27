import React, { useState } from "react";
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
import { WorkspaceView } from "./Workspace";
import { planUpdateViews, usePlanner } from "../planner";
import { SearchModal } from "./SearchModal";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { DeleteWorkspace } from "./DeleteNode";

export function PaneSearchButton(): JSX.Element {
  const [showSearch, setShowSearch] = useState(false);
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();

  const onSelectNode = (nodeID: ID): void => {
    setPane({ ...pane, stack: [nodeID] });
    setShowSearch(false);
  };

  return (
    <>
      <button
        type="button"
        className="split-pane-search btn btn-borderless"
        onClick={() => setShowSearch(true)}
        aria-label={`Search to change pane ${paneIndex} content`}
        title="Search"
      >
        <span className="simple-icon-magnifier" />
      </button>
      {showSearch && (
        <SearchModal
          onAddExistingNode={onSelectNode}
          onHide={() => setShowSearch(false)}
        />
      )}
    </>
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

  const paneClassName = isOtherUserContent
    ? "split-pane other-user-pane"
    : "split-pane";

  return (
    <div className={paneClassName}>
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
