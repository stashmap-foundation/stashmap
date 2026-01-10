import React, { useRef } from "react";
import { List } from "immutable";

import { useDndScrolling } from "react-dnd-scrolling";
import { EmptyColumn, WorkspaceColumnView } from "./WorkspaceColumn";

import { TemporaryViewProvider } from "./TemporaryViewContext";

import { getRelations } from "../connections";
import { PushNode, useNodeID, getNodeFromID } from "../ViewContext";
import { DND } from "../dnd";
import { useData } from "../DataContext";
import { usePaneNavigation } from "../SplitPanesContext";
import { getRelationTypeByRelationsID } from "./RelationTypes";
import { Node } from "./Node";

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

  const ref = useRef<HTMLDivElement>(null);

  /* eslint-disable react/jsx-props-no-spreading */
  const Scroller = React.useCallback(
    React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
      ({ children, ...props }, r) => {
        useDndScrolling(ref, {});
        return (
          <div ref={r} {...props}>
            {children}
          </div>
        );
      }
    ),
    []
  );
  /* eslint-enable react/jsx-props-no-spreading */

  /* eslint-disable react/no-array-index-key */
  const relations = getRelations(
    data.knowledgeDBs,
    view.relations,
    data.user.publicKey,
    workspaceID
  );
  const columns = relations ? relations.items.toArray() : [];

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
        <div className="position-absolute board overflow-y-hidden">
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
                  cardBodyClassName="pb-0 pt-8 pl-8 fullscreen-card-title"
                />
              </div>
              <div className="fullscreen-card-body">
                <DND>
                  <Scroller
                    ref={ref}
                    className="workspace-columns overflow-y-hidden h-100"
                    style={
                      {
                        "--workspace-relation-color": relationColor,
                      } as React.CSSProperties
                    }
                  >
                    {columns.map((column, index) => {
                      return (
                        <PushNode push={List([index])} key={index}>
                          <WorkspaceColumnView />
                        </PushNode>
                      );
                    })}
                    <EmptyColumn />
                  </Scroller>
                </DND>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TemporaryViewProvider>
  );
  /* eslint-enable react/no-array-index-key */
}
