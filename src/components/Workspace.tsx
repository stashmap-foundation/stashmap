import React from "react";

import { TemporaryViewProvider } from "./TemporaryViewContext";

import { getNodeFromID } from "../ViewContext";
import { DND } from "../dnd";
import { useData } from "../DataContext";
import {
  useSplitPanes,
  useCurrentPane,
  usePaneStack,
  usePaneIndex,
} from "../SplitPanesContext";
import { TreeView } from "./TreeView";
import { OpenInSplitPaneButtonWithStack } from "./OpenInSplitPaneButton";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";

function StackedLayer({
  workspaceID,
  stackUpToHere,
  onClick,
  showPaneControls,
  showFirstPaneControls,
}: {
  workspaceID: LongID;
  stackUpToHere: (LongID | ID)[];
  onClick: () => void;
  showPaneControls?: boolean;
  showFirstPaneControls?: boolean;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const workspaceNode = getNodeFromID(
    knowledgeDBs,
    workspaceID as string,
    user.publicKey
  );

  return (
    <div className="stacked-layer visible-on-hover">
      <div
        className="stacked-layer-clickable"
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span className="stacked-layer-title">
          {workspaceNode?.text || "Loading..."}
        </span>
        <span
          className="inline-node-actions"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <OpenInSplitPaneButtonWithStack stack={stackUpToHere} />
        </span>
      </div>
    </div>
  );
}

export function WorkspaceView(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();
  const paneIndex = usePaneIndex();

  const popTo = (index: number): void => {
    setPane({ ...pane, stack: stack.slice(0, index + 1) });
  };

  // Get stacked workspaces (all except the last one which is active)
  const stackedWorkspaces = stack.slice(0, -1);
  const hasStack = stackedWorkspaces.length > 0;

  return (
    <TemporaryViewProvider>
      <div className="position-relative flex-grow-1">
        <div className="position-absolute board">

          <div className="workspace-stack-container">

            {/* Sticky header with controls */}
            <div
              className="visible-on-hover"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                backgroundColor: "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 8px",
              }}
            >
              {/* Left side: Settings, Publishing Status, Sign In */}
              <div
                className="always-visible"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {!hasStack && paneIndex === 0 && (
                  <>
                    <PublishingStatusWrapper />
                    <PaneSettingsMenu />
                    <SignInMenuBtn />
                  </>
                )}
              </div>
              {/* Right side: Search, Close */}
              <div
                className="always-visible"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {<PaneSearchButton />}
                {<ClosePaneButton />}
              </div>
            </div>
            {/* Render stacked layers */}
            {stackedWorkspaces.map(
              (stackedWorkspaceID: LongID | ID, index: number) => (
                <StackedLayer
                  key={stackedWorkspaceID as string}
                  workspaceID={stackedWorkspaceID as LongID}
                  stackUpToHere={stack.slice(0, index + 1)}
                  onClick={() => popTo(index)}
                  showPaneControls={index === 0}
                  showFirstPaneControls={index === 0 && paneIndex === 0}
                />
              )
            )}

            {/* Render active fullscreen card */}
            <div className="fullscreen-card">
              <div className="fullscreen-card-body">
                <DND>
                  <TreeView />
                </DND>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TemporaryViewProvider>
  );
}
