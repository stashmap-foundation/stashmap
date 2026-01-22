import React, { useState } from "react";
import { Dropdown } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import {
  useSplitPanes,
  PaneNavigationProvider,
  PaneIndexProvider,
  usePaneNavigation,
  usePaneIndex,
  Pane,
} from "../SplitPanesContext";
import {
  RootViewContextProvider,
  updateViewPathsAfterPaneDelete,
} from "../ViewContext";
import { LoadNode, LoadNodeContent } from "../dataQuery";
import { WorkspaceView } from "./Workspace";
import { useWorkspaceContext } from "../WorkspaceContext";
import { planUpdateViews, usePlanner } from "../planner";
import { ROOT } from "../types";
import { SearchModal } from "./SearchModal";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { DeleteWorkspace } from "./DeleteNode";

export function PaneSearchButton(): JSX.Element {
  const [showSearch, setShowSearch] = useState(false);
  const { setStack } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  const onSelectNode = (nodeID: ID): void => {
    setStack([nodeID]);
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
  const { activeWorkspace, stack } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  return (
    <div className="split-pane">
      <LoadNodeContent nodeIDs={stack}>
        <RootViewContextProvider
          root={activeWorkspace as LongID}
          paneIndex={paneIndex}
        >
          <LoadNode referencedBy>
            <WorkspaceView />
          </LoadNode>
        </RootViewContextProvider>
      </LoadNodeContent>
    </div>
  );
}

function PaneWrapper({
  pane,
  index,
}: {
  pane: Pane;
  index: number;
}): JSX.Element {
  const { activeWorkspace } = useWorkspaceContext();
  // First pane respects URL/localStorage workspace
  // Additional panes use initialStack if set
  const initialWorkspace = index === 0 ? activeWorkspace : ROOT;

  return (
    <PaneIndexProvider index={index}>
      <PaneNavigationProvider
        initialWorkspace={initialWorkspace}
        initialStack={pane.initialStack}
      >
        <PaneContent />
      </PaneNavigationProvider>
    </PaneIndexProvider>
  );
}

export function SplitPaneLayout(): JSX.Element {
  const { panes } = useSplitPanes();

  return (
    <div className="split-pane-container">
      {panes.map((pane, index) => (
        <PaneWrapper key={pane.id} pane={pane} index={index} />
      ))}
    </div>
  );
}
