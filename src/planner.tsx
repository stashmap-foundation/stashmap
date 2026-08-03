/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, OrderedSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  newTimestamp,
  msTag,
} from "./nostr";
import { useData } from "./DataContext";
import { useExecutor } from "./ExecutorContext";
import {
  Document as KnowstrDocument,
  documentKeyOf,
  withDocumentRealWorldEntities,
} from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import { buildDocumentEvent } from "./nodesDocumentEvent";
import { newStorageKey } from "./storageEncryption";
import {
  EMPTY_NODE_ID,
  isEmptyNodeID,
  computeEmptyNodeMetadata,
  isSearchId,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planUpsertNodes,
  withDocumentRoot,
} from "./core/plan";
import {
  newGraphNode,
  ViewPath,
  updateView,
  getParentView,
  bulkUpdateViewPathsAfterAddNode,
} from "./rowModel";
import { plainSpans, spansText, spansToMarkdown } from "./core/nodeSpans";
import { calendarEntryEditedSpans } from "./core/ical";
import { classifyLinkHref } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";
import { entityIdForText } from "./core/entityRecognition";
import { getWorkspaceNode } from "./core/knowledge";
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
  planUpsertNodes,
} from "./core/plan";

type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
    paneUpdate: boolean;
  };

export type Plan = WorkspacePlan;

function isStandaloneEmbedLink(spans: InlineSpan[]): boolean {
  return (
    spans.length === 1 &&
    spans[0]?.kind === "link" &&
    (spans[0].href.startsWith("#") ||
      classifyLinkHref(spans[0].href) === "feed")
  );
}

export function planUpdateNodeSpans(
  plan: Plan,
  nodeID: ID,
  spans: InlineSpan[]
): Plan {
  const currentNode = getWorkspaceNode(plan.knowledgeDBs, nodeID);
  if (
    !currentNode ||
    spansToMarkdown(currentNode.spans) === spansToMarkdown(spans)
  ) {
    return plan;
  }
  return planUpsertNodes(plan, {
    ...currentNode,
    spans,
    ...(isStandaloneEmbedLink(spans) && {
      extraAttrs: { ...currentNode.extraAttrs, embed: "true" },
    }),
    updated: Date.now(),
  });
}

export function planUpdateNodeText(plan: Plan, nodeID: ID, text: string): Plan {
  return planUpdateNodeSpans(plan, nodeID, plainSpans(text));
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
    (itemID) => !isEmptyNodeID(itemID)
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
  parentID: ID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, ID[]] {
  const [updatedNodesPlan, actualItemIDs] = planAddTargetsToNode(
    plan,
    parentID,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews = bulkUpdateViewPathsAfterAddNode(updatedNodesPlan);

  return [planUpdateViews(updatedNodesPlan, updatedViews), actualItemIDs];
}

export function planAddSpansToParent(
  plan: Plan,
  spans: InlineSpan[],
  parentNode: GraphNode,
  insertAtIndex: number | undefined,
  relevance: Relevance,
  argument: Argument
): Plan {
  if (spans.every((span) => span.kind === "text")) {
    const [planWithNode, node] = planCreateNode(plan, spansText(spans));
    return planAddToParent(
      planWithNode,
      node,
      parentNode.id,
      insertAtIndex,
      relevance,
      argument
    )[0];
  }
  const node = {
    ...newGraphNode(spans, {
      root: parentNode.root,
      parent: parentNode.id,
      relevance,
      argument,
    }),
    ...(isStandaloneEmbedLink(spans) && {
      extraAttrs: { embed: "true" },
    }),
  };
  return planAddToParent(
    planUpsertNodes(plan, node),
    node.id,
    parentNode.id,
    insertAtIndex,
    relevance,
    argument
  )[0];
}

/**
 * Create a new node value for insertion into the current node tree.
 */
export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  const node: TextSeed = { text };
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

export function planCreateNoteAtRoot(
  plan: Plan,
  spans: InlineSpan[],
  paneIndex: number
): SaveNodeResult {
  const text = spansText(spans);
  // Mint or link, root case: recognized entity text as a new document's
  // root mints the entity node — idempotently. If the entity already has
  // a home, nothing is created: the pane opens the existing document.
  const entityId = spans.every((span) => span.kind === "text")
    ? entityIdForText(text)
    : undefined;
  const existingHome = entityId
    ? getWorkspaceNode(plan.knowledgeDBs, entityId as ID)
    : undefined;
  if (entityId && existingHome) {
    const panesAtExisting = plan.panes.map((p, i) =>
      i === paneIndex
        ? {
            ...p,
            author: LOCAL,
            sourceId: LOCAL,
            documentId: undefined,
            rootNodeId: existingHome.root,
            fallbackLabel: undefined,
            searchQuery: undefined,
            searchResultIDs: undefined,
          }
        : p
    );
    return {
      plan: planUpdatePanes(plan, panesAtExisting),
      viewPath: [paneIndex, existingHome.root],
      node: existingHome,
    };
  }

  const createdNode = {
    ...withDocumentRoot(
      newGraphNode(spans, entityId ? { uuid: entityId } : {})
    ),
    ...(isStandaloneEmbedLink(spans) && {
      extraAttrs: { embed: "true" },
    }),
  };
  const planWithNode = planUpsertNodes(plan, createdNode);

  const newPanes = planWithNode.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: LOCAL,
          sourceId: LOCAL,
          documentId: undefined,
          rootNodeId: createdNode.id,
          fallbackLabel: undefined,
          searchQuery: undefined,
          searchResultIDs: undefined,
        }
      : p
  );

  const resultPlan = planUpdatePanes(planWithNode, newPanes);
  const newViewPath: ViewPath = [paneIndex, createdNode.id];

  return { plan: resultPlan, viewPath: newViewPath, node: createdNode };
}

export function planSaveNodeAndEnsureNodes(
  plan: Plan,
  spans: InlineSpan[],
  nodeID: ID,
  currentNode: GraphNode,
  viewPath: ViewPath,
  parentNode: GraphNode | undefined,
  parentViewPath: ViewPath | undefined,
  paneIndex: number,
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const text = spansText(spans);
  const trimmedText = text.trim();

  if (isEmptyNodeID(nodeID)) {
    if (!parentViewPath) {
      if (!trimmedText) return { plan, viewPath, node: currentNode };
      return planCreateNoteAtRoot(plan, spans, paneIndex);
    }

    if (!trimmedText) {
      const resultPlan = parentNode
        ? planRemoveEmptyNodePosition(plan, parentNode.id)
        : plan;
      return { plan: resultPlan, viewPath, node: currentNode };
    }

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = parentNode
      ? emptyNodeMetadata.get(parentNode.id)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = parentNode
      ? planRemoveEmptyNodePosition(plan, parentNode.id)
      : plan;

    const resultPlan = parentNode
      ? planAddSpansToParent(
          planWithoutEmpty,
          spans,
          parentNode,
          emptyNodeIndex,
          relevance ?? metadata?.nodeItem.relevance,
          argument ?? metadata?.nodeItem.argument
        )
      : planWithoutEmpty;
    return { plan: resultPlan, viewPath, node: currentNode };
  }

  if (isSearchId(nodeID)) {
    return { plan, viewPath, node: currentNode };
  }

  const nextSpans = calendarEntryEditedSpans(currentNode, nodeID, spans);

  if (spansToMarkdown(nextSpans) === spansToMarkdown(currentNode.spans)) {
    return { plan, viewPath, node: currentNode };
  }

  return {
    plan: planUpdateNodeSpans(plan, currentNode.id, nextSpans),
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

export function buildDocumentWrites(plan: GraphPlan): {
  document: KnowstrDocument;
  content: string;
}[] {
  return plan.affectedDocuments.toArray().flatMap((docId) => {
    const rawDocument = plan.documents.get(documentKeyOf(LOCAL, docId));
    if (!rawDocument) {
      return [];
    }
    const document = withDocumentRealWorldEntities(
      plan.knowledgeDBs,
      plan.documents,
      plan.documentByFilePath,
      rawDocument
    );
    return [
      {
        document,
        content: renderDocumentMarkdown(plan.knowledgeDBs, document),
      },
    ];
  });
}

export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  if (!plan.user) {
    return plan.publishEvents;
  }
  const pubkey = plan.user.publicKey;
  const withUpserts = buildDocumentWrites(plan).reduce((events, write) => {
    const documentWithKey = {
      ...write.document,
      storageKey: write.document.storageKey ?? newStorageKey(),
    };
    const event = buildDocumentEvent(documentWithKey, pubkey, write.content);
    return events.push(event);
  }, plan.publishEvents);
  return plan.deletedDocs.reduce((events, docId) => {
    const deleteEvent: UnsignedEvent & EventAttachment = {
      kind: KIND_DELETE,
      pubkey,
      created_at: newTimestamp(),
      tags: [
        ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${pubkey}:${docId}`],
        ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
        msTag(),
      ],
      content: "",
      route: { kind: "storage" },
    };
    return events.push(deleteEvent);
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
  const dataRef = useRef(data);
  dataRef.current = data;
  const createPlanningContext = (): Plan => createPlan(dataRef.current);
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
  parentID: ID,
  parentView: View,
  parentViewPath: ViewPath,
  paneIndex: number,
  insertIndex: number
): Plan {
  const parentNode = getWorkspaceNode(plan.knowledgeDBs, parentID);
  if (!parentNode) {
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
        id: EMPTY_NODE_ID,
        spans: plainSpans(""),
        parent: parentNode.id,
        updated: Date.now(),
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
