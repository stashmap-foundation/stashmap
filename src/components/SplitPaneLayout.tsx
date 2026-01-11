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
import { LoadNode } from "../dataQuery";
import { WorkspaceView } from "./Workspace";
import { useWorkspaceContext } from "../WorkspaceContext";
import { planPublishSettings, planUpdateViews, usePlanner } from "../planner";
import { ROOT } from "../types";
import { SearchModal } from "./SearchModal";
import { useData } from "../DataContext";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";
import { DeleteWorkspace } from "./DeleteNode";

export function PaneSearchButton(): JSX.Element {
  const [showSearch, setShowSearch] = useState(false);
  const { push } = usePaneNavigation();

  const onSelectNode = (nodeID: LongID): void => {
    push(nodeID);
    setShowSearch(false);
  };

  return (
    <>
      <button
        type="button"
        className="split-pane-search btn btn-borderless"
        onClick={() => setShowSearch(true)}
        aria-label="Search to change pane content"
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

  // Don't show close button for first pane
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
  const { createPlan, executePlan } = usePlanner();
  const { settings, user } = useData();
  const isBionic = settings.bionicReading;
  const isLoggedIn = isUserLoggedIn(user);

  const onToggleBionic = async (): Promise<void> => {
    try {
      await executePlan(
        planPublishSettings(createPlan(), {
          ...settings,
          bionicReading: !isBionic,
        })
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };

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
        <Dropdown.Item
          className="d-flex workspace-selection"
          onClick={onToggleBionic}
          aria-label={`switch bionic reading ${isBionic ? "off" : "on"}`}
          tabIndex={0}
        >
          <span
            className={`simple-icon-eyeglass d-block dropdown-item-icon ${
              isBionic ? "bold" : ""
            }`}
          />
          <div className="workspace-selection-text">
            Turn {isBionic ? "off" : "on"} Bionic Reading
          </div>
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
  const { activeWorkspace } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  return (
    <div className="split-pane">
      <RootViewContextProvider
        root={activeWorkspace as LongID}
        paneIndex={paneIndex}
      >
        <LoadNode>
          <WorkspaceView />
        </LoadNode>
      </RootViewContextProvider>
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
  // Additional panes use initialNode if set, otherwise ROOT
  const initialWorkspace =
    index === 0 ? activeWorkspace : pane.initialNode || ROOT;

  return (
    <PaneIndexProvider index={index}>
      <PaneNavigationProvider initialWorkspace={initialWorkspace}>
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
