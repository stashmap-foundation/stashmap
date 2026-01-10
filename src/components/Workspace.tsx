import React from "react";

import { TemporaryViewProvider } from "./TemporaryViewContext";

import { useNodeID, getNodeFromID, useViewPath } from "../ViewContext";
import { DND } from "../dnd";
import { useData } from "../DataContext";
import { usePaneNavigation, usePaneIndex } from "../SplitPanesContext";
import { getRelationTypeByRelationsID } from "./RelationTypes";
import { Node } from "./Node";
import { TreeView } from "./TreeView";
import { getRelations } from "../connections";

function StackedLayer({
  workspaceID,
  onClick,
}: {
  workspaceID: LongID;
  onClick: () => void;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const workspaceNode = getNodeFromID(
    knowledgeDBs,
    workspaceID as string,
    user.publicKey
  );

  return (
    <div
      className="stacked-layer"
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
  );
}

export function WorkspaceView(): JSX.Element | null {
  const [workspaceID, view] = useNodeID();
  const data = useData();
  const { stack, popTo } = usePaneNavigation();

  // Get relation color
  const [relationType] = view.relations
    ? getRelationTypeByRelationsID(data, view.relations)
    : [undefined, undefined];
  const relationColor = relationType?.color;

  // Get stacked workspaces (all except the last one which is active)
  const stackedWorkspaces = stack.slice(0, -1);

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
                onClick={() => popTo(index)}
              />
            ))}

            {/* Render active fullscreen card */}
            <div className="fullscreen-card">
              <div className="fullscreen-card-header">
                <Node
                  className="border-0"
                  cardBodyClassName="pb-0 pt-8 ps-0 fullscreen-card-title"
                />
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
