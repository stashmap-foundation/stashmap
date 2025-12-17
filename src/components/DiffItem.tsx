import React, { useRef } from "react";
import { useDrag } from "react-dnd";
import { List } from "immutable";
import {
  ViewPath,
  getAvailableRelationsForNode,
  getNodeFromID,
  NodeIndex,
  DiffItem as DiffItemType,
} from "../ViewContext";
import { useData } from "../DataContext";
import { NOTE_TYPE } from "./Node";
import { Indent } from "./Node";
import { NodeCard } from "../commons/Ui";
import { NodeIcon } from "./NodeIcon";
import { useNavigationStack } from "../NavigationStackContext";
import { RELATION_TYPES } from "./RelationTypes";

type DiffItemProps = {
  diffItem: DiffItemType;
  parentPath: ViewPath;
  levels: number;
};

function RelationCountBadges({ nodeID }: { nodeID: LongID }): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const availableRelations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID
  );

  // Group relations by type and sum up item counts
  const relationCounts = availableRelations.groupBy((r) => r.type);

  return (
    <span className="diff-relation-badges">
      {relationCounts
        .filter((relations) => {
          const totalItems = relations?.reduce(
            (sum, r) => sum + r.items.size,
            0
          );
          return totalItems && totalItems > 0;
        })
        .entrySeq()
        .map(([typeID, relations]) => {
          const relationType = RELATION_TYPES.get(typeID as ID);
          const totalItems = relations?.reduce(
            (sum, r) => sum + r.items.size,
            0
          );
          if (!relationType || !totalItems) return null;

          return (
            <span
              key={typeID}
              className="diff-relation-badge"
              style={{ borderColor: relationType.color }}
              title={`${totalItems} ${relationType.label || "items"}`}
            >
              {totalItems}
            </span>
          );
        })
        .toArray()}
    </span>
  );
}

export function DiffItem({
  diffItem,
  parentPath,
  levels,
}: DiffItemProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const { knowledgeDBs, user } = useData();
  const { push } = useNavigationStack();

  const node = getNodeFromID(knowledgeDBs, diffItem.nodeID, user.publicKey);

  // Create a virtual path for dragging - this allows the DnD system to work
  // The path includes the parent's relation context but points to this diff item
  const virtualPath: ViewPath = [
    ...(parentPath.slice(0, -1) as Array<{
      nodeID: LongID | ID;
      nodeIndex: NodeIndex;
      relationsID: ID;
    }>),
    {
      nodeID: diffItem.nodeID,
      nodeIndex: 0 as NodeIndex,
    },
  ];

  // ONLY drag, NO drop - this is key for diff items
  const [{ isDragging }, drag] = useDrag({
    type: NOTE_TYPE,
    item: () => ({
      path: virtualPath,
      isDiffItem: true,
      sourceNodeID: diffItem.nodeID,
      sourceRelationId: diffItem.sourceRelationId,
    }),
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  });

  drag(ref);

  if (!node) {
    return null;
  }

  const onFullscreen = (): void => {
    push(diffItem.nodeID);
  };

  return (
    <div
      ref={ref}
      className={`diff-item ${isDragging ? "is-dragging" : ""}`}
      data-testid="diff-item"
    >
      <NodeCard className="diff-item-card" cardBodyClassName="ps-0 pt-4 pb-0">
        <Indent levels={levels} />
        <div className="flex-column w-100">
          <div className="diff-item-content">
            <span className="iconsminds-conference diff-item-icon" title="From other users" />
            <span className="break-word">
              <NodeIcon node={node} />
              {node.text}
            </span>
            <RelationCountBadges nodeID={diffItem.nodeID} />
          </div>
          <div className="diff-item-actions">
            <button
              type="button"
              aria-label="open fullscreen"
              className="btn btn-borderless btn-sm"
              onClick={onFullscreen}
              title="Open in fullscreen"
            >
              <span className="simple-icon-size-fullscreen" />
            </button>
          </div>
        </div>
      </NodeCard>
    </div>
  );
}

export type DiffSectionData = {
  parentPath: ViewPath;
  diffItems: List<DiffItemType>;
  levels: number;
  relationType: ID;
};
