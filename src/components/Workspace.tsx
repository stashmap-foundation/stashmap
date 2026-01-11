import React from "react";

import { TemporaryViewProvider } from "./TemporaryViewContext";

import { useNodeID, getNodeFromID } from "../ViewContext";
import { DND } from "../dnd";
import { useData } from "../DataContext";
import { usePaneNavigation, usePaneIndex } from "../SplitPanesContext";
import { getRelationTypeByRelationsID } from "./RelationTypes";
import { Node } from "./Node";
import { TreeView } from "./TreeView";
import {
  OpenInSplitPaneButton,
  OpenInSplitPaneButtonWithStack,
} from "./OpenInSplitPaneButton";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";

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
        <div className="stacked-layer-title">
          {workspaceNode?.text || "Loading..."}
        </div>
      </div>
      <div
        className="on-hover-menu right"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <span className="always-visible">
          {showFirstPaneControls && (
            <>
              <PublishingStatusWrapper />
              <PaneSettingsMenu />
            </>
          )}
          {showPaneControls && <ClosePaneButton />}
          {showPaneControls && <PaneSearchButton />}
          <OpenInSplitPaneButtonWithStack stack={stackUpToHere} />
        </span>
      </div>
    </div>
  );
}

export function WorkspaceView(): JSX.Element | null {
  const [, view] = useNodeID();
  const data = useData();
  const { stack, popTo } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  // Get relation color
  const [relationType] = view.relations
    ? getRelationTypeByRelationsID(data, view.relations)
    : [undefined, undefined];
  const relationColor = relationType?.color;

  // Get stacked workspaces (all except the last one which is active)
  const stackedWorkspaces = stack.slice(0, -1);
  const hasStack = stackedWorkspaces.length > 0;

  return (
    <TemporaryViewProvider>
      <div className="position-relative flex-grow-1">
        <div className="position-absolute board">
          <div className="workspace-stack-container">
            {/* Render stacked layers */}
            {stackedWorkspaces.map((stackedWorkspaceID, index) => (
              <StackedLayer
                key={stackedWorkspaceID as string}
                workspaceID={stackedWorkspaceID as LongID}
                stackUpToHere={stack.slice(0, index + 1)}
                onClick={() => popTo(index)}
                showPaneControls={index === 0}
                showFirstPaneControls={index === 0 && paneIndex === 0}
              />
            ))}

            {/* Render active fullscreen card */}
            <div className="fullscreen-card">
              <div className="fullscreen-card-header visible-on-hover">
                <Node
                  className="border-0"
                  cardBodyClassName="pb-0 pt-8 ps-0 fullscreen-card-title"
                />
                <div className="on-hover-menu right">
                  <span className="always-visible">
                    {!hasStack && paneIndex === 0 && (
                      <>
                        <PublishingStatusWrapper />
                        <PaneSettingsMenu />
                      </>
                    )}
                    {!hasStack && <ClosePaneButton />}
                    {!hasStack && <PaneSearchButton />}
                    <OpenInSplitPaneButton />
                  </span>
                </div>
              </div>
              <div
                className="fullscreen-card-body overflow-y-auto"
                style={
                  {
                    "--workspace-relation-color": relationColor,
                  } as React.CSSProperties
                }
              >
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
