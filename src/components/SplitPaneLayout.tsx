import React from "react";
import {
  useSplitPanes,
  PaneNavigationProvider,
  PaneIndexProvider,
  usePaneNavigation,
  usePaneIndex,
  Pane,
} from "../SplitPanesContext";
import { RootViewContextProvider } from "../ViewContext";
import { LoadNode } from "../dataQuery";
import { WorkspaceView } from "./Workspace";
import { useWorkspaceContext } from "../WorkspaceContext";

function PaneContent({ pane }: { pane: Pane }) {
  const { activeWorkspace } = usePaneNavigation();
  const { removePane } = useSplitPanes();
  const paneIndex = usePaneIndex();

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
          onClick={() => removePane(pane.id)}
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
