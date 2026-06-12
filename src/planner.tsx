/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, Map, OrderedSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  newTimestamp,
  msTag,
} from "./nostr";
import { useData } from "./DataContext";
import { useExecutor } from "./ExecutorContext";
import { documentKeyOf } from "./core/Document";
import {
  buildDocumentEvent,
  buildSnapshotEventFromNodes,
} from "./nodesDocumentEvent";
import { findTag } from "./nostrEvents";
import {
  EMPTY_SEMANTIC_ID,
  isEmptySemanticID,
  getNode,
  computeEmptyNodeMetadata,
  isSearchId,
  isRefNode,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planCopyDescendantNodes,
  planUpsertNodes,
  withDocumentRoot,
} from "./core/plan";
import {
  newGraphNode,
  ViewPath,
  updateView,
  getParentView,
  bulkUpdateViewPathsAfterAddNode,
  copyViewsWithNodesMapping,
  viewPathToString,
  addNodeToPathWithNodes,
} from "./rowModel";
import { nodeText, plainSpans } from "./core/nodeSpans";
import { LOCAL } from "./core/nodeRef";
import { useRelaysToCreatePlan } from "./relays";
import {
  MultiSelectionState,
  clearSelection,
  shiftSelect,
  toggleSelect,
} from "./core/selection";

export type { AddToParentTarget, GraphPlan } from "./core/plan";
export {
  createGraphPlan,
  planAddTargetsToNode,
  planAddTopTargetsToDocument,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planPublishRelayMetadata,
  planUpsertNodes,
  relayTags,
} from "./core/plan";

type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    paneUpdate: boolean;
  };

export type Plan = WorkspacePlan;

export function planUpdateNodeText(
  plan: Plan,
  currentNode: GraphNode,
  text: string
): Plan {
  if (currentNode.author !== LOCAL) {
    return plan;
  }
  if (nodeText(currentNode) === text) {
    return plan;
  }
  const updatedNode = {
    ...currentNode,
    spans: plainSpans(text),
    updated: Date.now(),
  };
  return planUpsertNodes(plan, updatedNode);
}

function removeEmptyNodeFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  sourceId: SourceId,
  nodeID: ID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(sourceId);
  if (!myDB) {
    return knowledgeDBs;
  }

  const existingNodeID = nodeID;
  const existingNodes = myDB.nodes.get(existingNodeID);
  if (!existingNodes) {
    return knowledgeDBs;
  }

  const filteredItems = existingNodes.children.filter(
    (itemID) => !isEmptySemanticID(itemID)
  );
  if (filteredItems.size === existingNodes.children.size) {
    return knowledgeDBs;
  }

  const updatedNodes = myDB.nodes.set(existingNodeID, {
    ...existingNodes,
    children: filteredItems,
  });
  return knowledgeDBs.set(sourceId, {
    ...myDB,
    nodes: updatedNodes,
  });
}

export function planUpdateViews(plan: Plan, views: Views): Plan {
  return {
    ...plan,
    views,
  };
}

export function planUpdatePanes(plan: Plan, panes: Pane[]): Plan {
  return {
    ...plan,
    panes,
    paneUpdate: true,
  };
}

export function planSetRowFocusIntent(
  plan: Plan,
  intent: Omit<RowFocusIntent, "requestId">
): Plan {
  const currentMaxRequestId = Math.max(
    0,
    ...plan.temporaryView.rowFocusIntents
      .valueSeq()
      .map((currentIntent) => currentIntent.requestId)
      .toArray()
  );
  const requestId = currentMaxRequestId + 1;
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      rowFocusIntents: plan.temporaryView.rowFocusIntents.set(
        intent.paneIndex,
        {
          ...intent,
          requestId,
        }
      ),
    },
  };
}

function getTemporarySelectionState(plan: Plan): MultiSelectionState {
  return {
    baseSelection: plan.temporaryView.baseSelection,
    shiftSelection: plan.temporaryView.shiftSelection,
    anchor: plan.temporaryView.anchor,
  };
}

export function planSetTemporarySelectionState(
  plan: Plan,
  state: MultiSelectionState
): Plan {
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      baseSelection: state.baseSelection,
      shiftSelection: state.shiftSelection,
      anchor: state.anchor,
    },
  };
}

export function planToggleTemporarySelection(
  plan: Plan,
  viewKey: string
): Plan {
  return planSetTemporarySelectionState(
    plan,
    toggleSelect(getTemporarySelectionState(plan), viewKey)
  );
}

export function planShiftTemporarySelection(
  plan: Plan,
  orderedKeys: string[],
  targetViewKey: string,
  fallbackAnchor?: string
): Plan {
  const current = getTemporarySelectionState(plan);
  const effectiveAnchor = current.anchor || fallbackAnchor;
  if (!effectiveAnchor) {
    return plan;
  }
  return planSetTemporarySelectionState(
    plan,
    shiftSelect(
      {
        ...current,
        anchor: effectiveAnchor,
      },
      orderedKeys,
      targetViewKey
    )
  );
}

export function planClearTemporarySelection(plan: Plan, anchor?: string): Plan {
  return planSetTemporarySelectionState(
    plan,
    clearSelection({
      ...getTemporarySelectionState(plan),
      anchor: anchor ?? plan.temporaryView.anchor,
    })
  );
}

export function planSelectAllTemporaryRows(
  plan: Plan,
  orderedKeys: string[],
  anchor?: string
): Plan {
  return planSetTemporarySelectionState(plan, {
    baseSelection: OrderedSet<string>(orderedKeys),
    shiftSelection: OrderedSet<string>(),
    anchor: anchor ?? plan.temporaryView.anchor,
  });
}

export function planRemoveEmptyNodePosition(plan: Plan, nodeID: ID): Plan {
  return {
    ...plan,
    knowledgeDBs: removeEmptyNodeFromKnowledgeDBs(
      plan.knowledgeDBs,
      LOCAL,
      nodeID
    ),
    temporaryEvents: plan.temporaryEvents.push({
      type: "REMOVE_EMPTY_NODE",
      nodeID,
    }),
  };
}

export function planExpandNode(
  plan: Plan,
  view: View,
  viewPath: ViewPath
): Plan {
  if (view.expanded) {
    return plan;
  }
  return planUpdateViews(
    plan,
    updateView(plan.views, viewPath, {
      ...view,
      expanded: true,
    })
  );
}

export function planAddToParent(
  plan: Plan,
  targets: AddToParentTarget | AddToParentTarget[],
  parentNode: GraphNode,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, ID[]] {
  const [updatedNodesPlan, actualItemIDs] = planAddTargetsToNode(
    plan,
    parentNode,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews = bulkUpdateViewPathsAfterAddNode(updatedNodesPlan);

  return [planUpdateViews(updatedNodesPlan, updatedViews), actualItemIDs];
}

type NodesIdMapping = Map<ID, ID>;

function updateViewsWithNodesMapping(
  views: Views,
  nodesIdMapping: Map<ID, ID>
): Views {
  return views.mapEntries(([key, view]) => {
    const newKey = nodesIdMapping.reduce(
      (k, newId, oldId) => k.split(oldId).join(newId),
      key
    );
    return [newKey, view];
  });
}

export function planForkPane(
  plan: Plan,
  paneIndex: number,
  pane: Pane,
  sourceNode: GraphNode
): Plan {
  const [planWithNodes, nodesIdMapping] = planCopyDescendantNodes(
    plan,
    sourceNode,
    (node) => node.author === pane.author
  );
  const updatedViews = updateViewsWithNodesMapping(
    planWithNodes.views,
    nodesIdMapping
  );
  const planWithUpdatedViews = planUpdateViews(planWithNodes, updatedViews);
  const newRootNodeId = pane.rootNodeId
    ? nodesIdMapping.get(pane.rootNodeId)
    : nodesIdMapping.get(sourceNode.id);
  const newPanes = planWithUpdatedViews.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: LOCAL,
          sourceId: LOCAL,
          rootNodeId: newRootNodeId,
        }
      : p
  );
  return planUpdatePanes(planWithUpdatedViews, newPanes);
}

function copyDeepNodeViewState(
  planWithCopy: Plan,
  nodesIdMapping: NodesIdMapping,
  sourceViewPath: ViewPath,
  targetParentNode: GraphNode,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number
): Plan {
  const nodes =
    getNode(planWithCopy.knowledgeDBs, targetParentNode.id, LOCAL) ??
    targetParentNode;
  if (nodes.children.size === 0) {
    return planWithCopy;
  }

  const targetIndex = insertAtIndex ?? nodes.children.size - 1;
  const targetViewPath = addNodeToPathWithNodes(
    targetParentViewPath,
    nodes,
    targetIndex
  );

  const sourceKey = viewPathToString(sourceViewPath);
  const targetKey = viewPathToString(targetViewPath);

  const updatedViews = copyViewsWithNodesMapping(
    planWithCopy.views,
    sourceKey,
    targetKey,
    nodesIdMapping
  );

  return planUpdateViews(planWithCopy, updatedViews);
}

export function planDeepCopyNode(
  plan: Plan,
  resolvedNode: GraphNode,
  targetParentNode: GraphNode,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): Plan {
  const [planWithCopiedNodes, mapping] = planCopyDescendantNodes(
    plan,
    resolvedNode,
    undefined,
    targetParentNode.id,
    targetParentNode.root
  );

  const copiedTopNodeID = mapping.get(resolvedNode.id);
  if (!copiedTopNodeID) {
    return planWithCopiedNodes;
  }

  const [finalPlan] = planAddToParent(
    planWithCopiedNodes,
    copiedTopNodeID,
    targetParentNode,
    insertAtIndex,
    relevance,
    argument
  );

  return copyDeepNodeViewState(
    finalPlan,
    mapping,
    sourceViewPath,
    targetParentNode,
    targetParentViewPath,
    insertAtIndex
  );
}

/**
 * Create a new node value for insertion into the current node tree.
 */
export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  const node: TextSeed = {
    id: text as ID,
    text,
  };
  return [plan, node];
}

export type ParsedLine = { text: string; depth: number };

export function parseClipboardText(text: string): ParsedLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const tabMatch = line.match(/^(\t*)/);
      const tabDepth = tabMatch ? tabMatch[1].length : 0;
      const spaceMatch = line.match(/^( +)/);
      const spaceDepth = spaceMatch ? Math.floor(spaceMatch[1].length / 2) : 0;
      const depth = tabDepth > 0 ? tabDepth : spaceDepth;
      const content = line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "");
      return { text: content, depth };
    })
    .filter((item) => item.text.length > 0);
}

type SaveNodeResult = {
  plan: Plan;
  viewPath: ViewPath;
  node: GraphNode;
};

function planCreateNoteAtRoot(
  plan: Plan,
  text: string,
  paneIndex: number
): SaveNodeResult {
  const [planWithSeed, createdSeed] = planCreateNode(plan, text);
  const createdNode = withDocumentRoot(
    newGraphNode(LOCAL, plainSpans(createdSeed.text))
  );
  const planWithNode = planUpsertNodes(planWithSeed, createdNode);

  const newPanes = planWithNode.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: LOCAL,
          sourceId: LOCAL,
          documentId: undefined,
          rootNodeId: createdNode.id,
          searchQuery: undefined,
          searchResultIDs: undefined,
        }
      : p
  );

  const resultPlan = planUpdatePanes(planWithNode, newPanes);
  const newViewPath: ViewPath = [paneIndex, createdNode.id];

  return { plan: resultPlan, viewPath: newViewPath, node: createdNode };
}

/**
 * Save node text - either materialize an empty node or create a version for existing node.
 * Returns the updated plan and the viewPath of the saved node.
 */
export function planSaveNodeAndEnsureNodes(
  plan: Plan,
  text: string,
  rowID: ID,
  currentNode: GraphNode,
  viewPath: ViewPath,
  parentNode: GraphNode | undefined,
  parentViewPath: ViewPath | undefined,
  paneIndex: number,
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const trimmedText = text.trim();

  if (isEmptySemanticID(rowID)) {
    if (!parentViewPath) {
      if (!trimmedText) return { plan, viewPath, node: currentNode };
      return planCreateNoteAtRoot(plan, trimmedText, paneIndex);
    }

    if (!trimmedText) {
      const resultPlan = parentNode
        ? planRemoveEmptyNodePosition(plan, parentNode.id)
        : plan;
      return { plan: resultPlan, viewPath, node: currentNode };
    }

    const [planWithNode, createdNode] = planCreateNode(plan, trimmedText);

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = parentNode
      ? emptyNodeMetadata.get(parentNode.id)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = parentNode
      ? planRemoveEmptyNodePosition(planWithNode, parentNode.id)
      : planWithNode;

    const [resultPlan] = parentNode
      ? planAddToParent(
          planWithoutEmpty,
          createdNode,
          parentNode,
          emptyNodeIndex,
          relevance ?? metadata?.nodeItem.relevance,
          argument ?? metadata?.nodeItem.argument
        )
      : [planWithoutEmpty, []];
    return { plan: resultPlan, viewPath, node: currentNode };
  }

  const currentItem = getNode(plan.knowledgeDBs, rowID, LOCAL);
  if ((currentItem && isRefNode(currentItem)) || isSearchId(rowID)) {
    return { plan, viewPath, node: currentNode };
  }

  const displayText = nodeText(currentNode);

  if (trimmedText === displayText) {
    return { plan, viewPath, node: currentNode };
  }

  return {
    plan: planUpdateNodeText(plan, currentNode, trimmedText),
    viewPath,
    node: currentNode,
  };
}

export function getNextInsertPosition(
  plan: Plan,
  viewPath: ViewPath,
  nodeIsRoot: boolean,
  nodeIsExpanded: boolean,
  nodeIndex: number | undefined
): { parentPath: ViewPath; insertAt: number } | null {
  if (nodeIsRoot || nodeIsExpanded) {
    return { parentPath: viewPath, insertAt: 0 };
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) return null;

  return { parentPath, insertAt: (nodeIndex ?? 0) + 1 };
}

type ExecutePlan = (plan: Plan) => Promise<void>;

type Planner = {
  createPlan: () => Plan;
  executePlan: ExecutePlan;
  republishEvents: RepublishEvents;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

type PlanningContextValue = Pick<
  Planner,
  "executePlan" | "republishEvents" | "setPublishEvents"
> & {
  setPanes: Dispatch<SetStateAction<Pane[]>>;
};

const PlanningContext = React.createContext<PlanningContextValue | undefined>(
  undefined
);

// Filter out empty placeholder nodes from events before publishing
// Empty nodes are injected at read time via injectEmptyNodesIntoKnowledgeDBs,
// so any nodes modification will include them - we need to filter before publishing
function resolveBasedOnNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID,
  myself: SourceId
): GraphNode | undefined {
  const own = getNode(knowledgeDBs, nodeID, myself);
  if (own) {
    return own;
  }
  return knowledgeDBs
    .keySeq()
    .sort()
    .map((author) => getNode(knowledgeDBs, nodeID, author))
    .find((node) => node !== undefined);
}

function getSnapshotSourceRoot(
  knowledgeDBs: KnowledgeDBs,
  snapshotAnchorNode: GraphNode | undefined,
  fallbackAuthor: SourceId
): GraphNode | undefined {
  if (!snapshotAnchorNode?.basedOn) {
    return undefined;
  }
  const sourceNode = resolveBasedOnNode(
    knowledgeDBs,
    snapshotAnchorNode.basedOn,
    fallbackAuthor
  );
  return sourceNode
    ? getNode(knowledgeDBs, sourceNode.root, sourceNode.author)
    : undefined;
}

export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  const pubkey = plan.user.publicKey;
  const withUpserts = plan.affectedDocuments.reduce((events, docId) => {
    const document = plan.documents.get(documentKeyOf(LOCAL, docId));
    if (!document) {
      return events;
    }
    const topNodes = document.topNodeShortIds
      .map((topNodeShortId) =>
        plan.knowledgeDBs.get(LOCAL)?.nodes.get(topNodeShortId)
      )
      .filter((node): node is GraphNode => node !== undefined);
    const snapshotAnchorNode = topNodes.find(
      (topNode) => topNode.basedOn && !topNode.snapshotId
    );
    const snapshotSourceRoot = getSnapshotSourceRoot(
      plan.knowledgeDBs,
      snapshotAnchorNode,
      LOCAL
    );
    const sourceDocument = snapshotSourceRoot?.docId
      ? plan.documents.get(
          documentKeyOf(snapshotSourceRoot.author, snapshotSourceRoot.docId)
        )
      : undefined;
    const snapshotEvent = sourceDocument
      ? (buildSnapshotEventFromNodes(
          plan.knowledgeDBs,
          pubkey,
          sourceDocument
        ) as UnsignedEvent & EventAttachment)
      : undefined;
    const event = buildDocumentEvent(plan.knowledgeDBs, document, pubkey, {
      snapshotId:
        topNodes.find((topNode) => topNode.snapshotId)?.snapshotId ??
        (snapshotEvent ? findTag(snapshotEvent, "d") : undefined),
    });
    return snapshotEvent
      ? events
          .push(snapshotEvent)
          .push(event as UnsignedEvent & EventAttachment)
      : events.push(event as UnsignedEvent & EventAttachment);
  }, plan.publishEvents);
  return plan.deletedDocs.reduce((events, docId) => {
    const deleteEvent = {
      kind: KIND_DELETE,
      pubkey,
      created_at: newTimestamp(),
      tags: [
        ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${pubkey}:${docId}`],
        ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
        msTag(),
      ],
      content: "",
    };
    return events.push(deleteEvent as UnsignedEvent & EventAttachment);
  }, withUpserts);
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
  setPanes,
  setViews,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
}): JSX.Element {
  const executor = useExecutor();
  const setViewsRef = useRef(setViews);
  // eslint-disable-next-line functional/immutable-data
  setViewsRef.current = setViews;

  return (
    <PlanningContext.Provider
      value={{
        executePlan: executor.executePlan,
        republishEvents: executor.republishEvents,
        setPublishEvents,
        setPanes,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export function createPlan(
  props: Data & {
    publishEvents?: List<UnsignedEvent & EventAttachment>;
    relays: AllRelays;
  }
): Plan {
  return {
    ...createGraphPlan(props),
    publishEventsStatus: props.publishEventsStatus,
    views: props.views,
    panes: props.panes,
    temporaryView: props.publishEventsStatus.temporaryView,
    temporaryEvents: List<TemporaryEvent>(),
    paneUpdate: false,
  };
}

export function usePlanner(): Planner {
  const data = useData();
  const relays = useRelaysToCreatePlan();
  const dataRef = useRef(data);
  const relaysRef = useRef(relays);
  dataRef.current = data;
  relaysRef.current = relays;
  const createPlanningContext = (): Plan => {
    return createPlan({
      ...dataRef.current,
      relays: relaysRef.current,
    });
  };
  const planningContext = React.useContext(PlanningContext);
  if (planningContext === undefined) {
    throw new Error("PlanningContext not provided");
  }

  return {
    createPlan: createPlanningContext,
    executePlan: planningContext.executePlan,
    republishEvents: planningContext.republishEvents,
    setPublishEvents: planningContext.setPublishEvents,
    setPanes: planningContext.setPanes,
  };
}

// Plan function to set an empty node position (for creating new node editor)
// This is simpler than creating actual node events - just stores where to inject
export function planSetEmptyNodePosition(
  plan: Plan,
  parentNode: GraphNode,
  parentView: View,
  parentViewPath: ViewPath,
  paneIndex: number,
  insertIndex: number
): Plan {
  if (parentNode.author !== LOCAL) {
    return plan;
  }
  const planWithExpanded = planExpandNode(plan, parentView, parentViewPath);

  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID: parentNode.id,
      index: insertIndex,
      nodeItem: {
        children: List<ID>(),
        id: EMPTY_SEMANTIC_ID,
        spans: plainSpans(""),
        parent: parentNode.id,
        updated: Date.now(),
        author: LOCAL,
        root: parentNode.root,
        relevance: undefined,
      },
      paneIndex,
    }),
  };
}

export function planUpdateEmptyNodeMetadata(
  plan: Plan,
  nodeID: ID,
  metadata: { relevance?: Relevance; argument?: Argument }
): Plan {
  const currentMetadata = computeEmptyNodeMetadata(
    plan.publishEventsStatus.temporaryEvents
  );
  const existing = currentMetadata.get(nodeID);
  if (!existing) {
    return plan;
  }

  const updatedNodeItem: GraphNode = {
    ...existing.nodeItem,
    relevance: metadata.relevance ?? existing.nodeItem.relevance,
    argument: metadata.argument ?? existing.nodeItem.argument,
  };

  return {
    ...plan,
    temporaryEvents: plan.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID,
      index: existing.index,
      nodeItem: updatedNodeItem,
      paneIndex: existing.paneIndex,
    }),
  };
}
