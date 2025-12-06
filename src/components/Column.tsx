import React from "react";
import { useMediaQuery } from "react-responsive";
import { NodeCard, UIColumn } from "../commons/Ui";
import { bulkAddRelations } from "../connections";
import { FileDropZone } from "./FileDropZone";
import { Indent } from "./Node";
import { useDeselectAllInView } from "./TemporaryViewContext";
import { upsertRelations, useViewKey, useViewPath } from "../ViewContext";
import { TreeView } from "./TreeView";
import { AddNodeToNode } from "./AddNode";
import { Plan, usePlanner } from "../planner";
import { IS_MOBILE } from "./responsive";
import { DraggableNote } from "./Draggable";
import { DroppableContainer } from "./DroppableContainer";

/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable @typescript-eslint/unbound-method */
export function Column(): JSX.Element | null {
  const viewContext = useViewPath();
  const deselectByPostfix = useDeselectAllInView();
  const viewKey = useViewKey();
  const { executePlan } = usePlanner();
  const isMobile = useMediaQuery(IS_MOBILE);
  const onDropFiles = (plan: Plan, topNodes: Array<LongID>): void => {
    const addTopNodesPlan = upsertRelations(plan, viewContext, (r: Relations) =>
      bulkAddRelations(r, topNodes)
    );
    executePlan(addTopNodesPlan);
    deselectByPostfix(viewKey);
  };

  return (
    <UIColumn>
      <FileDropZone onDrop={onDropFiles}>
        <DroppableContainer>
          <DraggableNote />
        </DroppableContainer>
        <TreeView />
        <div>
          <DroppableContainer>
            <NodeCard
              className={
                !isMobile ? "hover-light-bg border-top-strong" : undefined
              }
            >
              <Indent levels={2} />
              <AddNodeToNode />
            </NodeCard>
          </DroppableContainer>
        </div>
      </FileDropZone>
    </UIColumn>
  );
}
/* eslint-enable react/jsx-props-no-spreading */
/* eslint-enable @typescript-eslint/unbound-method */
