import React from "react";
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
import { planUpdateViews, usePlanner } from "../planner";

function PaneContent({ pane }: { pane: Pane }) {
  const { activeWorkspace } = usePaneNavigation();
  const { removePane } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { createPlan, executePlan } = usePlanner();

  const handleRemovePane = (): void => {
    // Update view settings: delete views for this pane and shift indices
    const plan = createPlan();
    const updatedViews = updateViewPathsAfterPaneDelete(plan.views, paneIndex);
    executePlan(planUpdateViews(plan, updatedViews));
    // Remove the pane from state
    removePane(pane.id);
  };

  return (
    <div className="split-pane">
      <RootViewContextProvider
        root={activeWorkspace as LongID}
        paneIndex={paneIndex}
      >
        <LoadNode waitForEose>
          <WorkspaceView />
        </LoadNode>
      </RootViewContextProvider>
      {paneIndex > 0 && (
        <button
          type="button"
          className="split-pane-close btn btn-borderless"
          onClick={handleRemovePane}
          aria-label="Close pane"
        >
          <span className="btn-close small" />
        </button>
      )}
    </div>
  );
}

function PaneWrapper({ pane, index }: { pane: Pane; index: number }) {
  const { activeWorkspace } = useWorkspaceContext();

  return (
    <PaneIndexProvider index={index}>
      <PaneNavigationProvider initialWorkspace={activeWorkspace}>
        <PaneContent pane={pane} />
      </PaneNavigationProvider>
    </PaneIndexProvider>
  );
}

export function SplitPaneLayout(): JSX.Element {
  const { panes, addPane } = useSplitPanes();

  return (
    <div className="split-pane-container">
      {panes.map((pane, index) => (
        <PaneWrapper key={pane.id} pane={pane} index={index} />
      ))}
      <button
        type="button"
        className="split-pane-add btn"
        onClick={() => addPane()}
        aria-label="Add pane"
        title="Add split pane"
      >
        <span className="simple-icon-plus" />
      </button>
    </div>
  );
}
