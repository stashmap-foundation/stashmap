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
import { newDB } from "./core/knowledge";
import { documentKeyOf } from "./core/Document";
import {
  buildDocumentEvent,
  buildSnapshotEventFromNodes,
} from "./nodesDocumentEvent";
import {
  shortID,
  EMPTY_SEMANTIC_ID,
  isEmptySemanticID,
  getNode,
  resolveNode,
  computeEmptyNodeMetadata,
  isSearchId,
  getNodeContext,
  getSemanticID,
  isRefNode,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planCopyDescendantNodes,
  planUpsertContact,
  planUpsertNodes,
} from "./core/plan";
import {
  newNode,
  upsertNodes,
  ViewPath,
  getRowIDFromView,
  updateView,
  getContext,
  getParentView,
  bulkUpdateViewPathsAfterAddNode,
  copyViewsWithNodesMapping,
  viewPathToString,
  getNodeForView,
  addNodeToPathWithNodes,
  getPaneIndex,
} from "./ViewContext";
import { nodeText, plainSpans } from "./core/nodeSpans";
import { UNAUTHENTICATED_USER_PK } from "./NostrAuthContext";
import { useRelaysToCreatePlan } from "./relays";
import {
  MultiSelectionState,
  clearSelection,
  shiftSelect,
  toggleSelect,
} from "./core/selection";
import {
  withUsersEntryPublicKey,
  getNodeUserPublicKey,
} from "./infra/nostr/userEntry";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";

export type { AddToParentTarget, GraphPlan } from "./core/plan";
export {
  createGraphPlan,
  planAddContacts,
  planAddTargetsToNode,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planPublishRelayMetadata,
  planRemoveContact,
  planUpsertContact,
  planUpsertNodes,
  relayTags,
} from "./core/plan";

export function getPane(plan: Plan | Data, viewPath: ViewPath): Pane {
  const paneIndex = viewPath[0];
  return plan.panes[paneIndex];
}

type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

export type Plan = WorkspacePlan;

export function planUpdateNodeText(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  text: string
): Plan {
  const currentNode = getNodeForView(plan, viewPath, stack);
  if (!currentNode || currentNode.author !== plan.user.publicKey) {
    return plan;
  }
  if (nodeText(currentNode) === text) {
    return plan;
  }
  const updatedNode = withUsersEntryPublicKey({
    ...currentNode,
    spans: plainSpans(text),
    updated: Date.now(),
  });
  const basePlan = planUpsertNodes(plan, updatedNode);
  const userPublicKey = getNodeUserPublicKey(currentNode, text);
  const isCustomName = !decodePublicKeyInputSync(text);
  if (userPublicKey && basePlan.contacts.has(userPublicKey)) {
    return planUpsertContact(basePlan, {
      ...basePlan.contacts.get(userPublicKey)!,
      userName: isCustomName ? text : undefined,
    });
  }
  return basePlan;
}

function removeEmptyNodeFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  publicKey: PublicKey,
  nodeID: LongID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(publicKey);
  if (!myDB) {
    return knowledgeDBs;
  }

  const shortNodesID = nodeID.includes("_") ? nodeID.split("_")[1] : nodeID;
  const existingNodes = myDB.nodes.get(shortNodesID);
  if (!existingNodes) {
    return knowledgeDBs;
  }

  const filteredItems = existingNodes.children.filter(
    (itemID) => !isEmptySemanticID(itemID)
  );
  if (filteredItems.size === existingNodes.children.size) {
    return knowledgeDBs;
  }

  const updatedNodes = myDB.nodes.set(shortNodesID, {
    ...existingNodes,
    children: filteredItems,
  });
  return knowledgeDBs.set(publicKey, {
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

export function planRemoveEmptyNodePosition(plan: Plan, nodeID: LongID): Plan {
  return {
    ...plan,
    knowledgeDBs: removeEmptyNodeFromKnowledgeDBs(
      plan.knowledgeDBs,
      plan.user.publicKey,
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
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, ID[]] {
  const ensureParentNode = (): [Plan, GraphNode] => {
    const [, parentView] = getRowIDFromView(plan, parentViewPath);
    const planWithExpand = planExpandNode(plan, parentView, parentViewPath);
    const existingNode = getNodeForView(planWithExpand, parentViewPath, stack);
    if (existingNode) {
      return [planWithExpand, existingNode];
    }
    const planWithParentNode = upsertNodes(
      planWithExpand,
      parentViewPath,
      stack,
      (nodes) => nodes
    );
    const parentNode = getNodeForView(
      planWithParentNode,
      parentViewPath,
      stack
    );
    if (!parentNode) {
      throw new Error("Failed to create parent node");
    }
    return [planWithParentNode, parentNode];
  };

  const [planWithParent, parentNode] = ensureParentNode();
  const [updatedNodesPlan, actualItemIDs] = planAddTargetsToNode(
    planWithParent,
    parentNode,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews = bulkUpdateViewPathsAfterAddNode(updatedNodesPlan);

  return [planUpdateViews(updatedNodesPlan, updatedViews), actualItemIDs];
}

type NodesIdMapping = Map<LongID, LongID>;

function updateViewsWithNodesMapping(
  views: Views,
  nodesIdMapping: Map<LongID, LongID>
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
  viewPath: ViewPath,
  stack: ID[]
): Plan {
  const pane = getPane(plan, viewPath);

  const rootNode = pane.rootNodeId
    ? getNode(
        plan.knowledgeDBs,
        pane.rootNodeId,
        pane.author || plan.user.publicKey
      )
    : undefined;

  const sourceNode = rootNode || getNodeForView(plan, viewPath, stack);
  if (!sourceNode) {
    return plan;
  }
  const [planWithNodes, nodesIdMapping] = planCopyDescendantNodes(
    plan,
    sourceNode,
    (node) => getNodeContext(plan.knowledgeDBs, node),
    (node) => node.author === pane.author
  );
  const updatedViews = updateViewsWithNodesMapping(
    planWithNodes.views,
    nodesIdMapping
  );
  const planWithUpdatedViews = planUpdateViews(planWithNodes, updatedViews);
  const paneIndex = viewPath[0];
  const newRootNodeId = pane.rootNodeId
    ? nodesIdMapping.get(pane.rootNodeId)
    : undefined;
  const newPanes = planWithUpdatedViews.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: plan.user.publicKey,
          rootNodeId: newRootNodeId,
        }
      : p
  );
  return planUpdatePanes(planWithUpdatedViews, newPanes);
}

export function planDeepCopyNode(
  plan: Plan,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [Plan, NodesIdMapping] {
  const [sourceItemID] = getRowIDFromView(plan, sourceViewPath);
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceSemanticContext = getContext(plan, sourceViewPath, sourceStack);
  const sourceNode = getNodeForView(plan, sourceViewPath, sourceStack);

  const resolveSource = (): {
    itemID: ID;
    semanticContext: Context;
    node?: GraphNode;
  } => {
    const sourceItemNode = getNode(
      plan.knowledgeDBs,
      sourceItemID,
      plan.user.publicKey
    );
    if (isRefNode(sourceItemNode)) {
      const node = resolveNode(plan.knowledgeDBs, sourceItemNode);
      if (node) {
        return {
          itemID: getSemanticID(plan.knowledgeDBs, node),
          semanticContext: getNodeContext(plan.knowledgeDBs, node),
          node,
        };
      }
    }
    return {
      itemID: sourceItemID,
      semanticContext: sourceSemanticContext,
      node: sourceNode,
    };
  };

  const resolved = resolveSource();
  const resolvedItemID = resolved.itemID;
  const resolvedSemanticContext = resolved.semanticContext;
  const resolvedNode = resolved.node;

  const [planWithParent, targetParentNode] = (() => {
    const parentNode = getNodeForView(plan, targetParentViewPath, stack);
    if (parentNode) {
      return [plan, parentNode] as const;
    }
    const planWithCreatedParent = upsertNodes(
      plan,
      targetParentViewPath,
      stack,
      (nodes) => nodes
    );
    const createdParent = getNodeForView(
      planWithCreatedParent,
      targetParentViewPath,
      stack
    );
    if (!createdParent) {
      throw new Error("Failed to create target parent node");
    }
    return [planWithCreatedParent, createdParent] as const;
  })();

  const targetParentSemanticContext = getContext(
    planWithParent,
    targetParentViewPath,
    stack
  );
  const [targetParentRowID] = getRowIDFromView(
    planWithParent,
    targetParentViewPath
  );
  const targetRootContext = targetParentSemanticContext.push(
    targetParentNode
      ? getSemanticID(planWithParent.knowledgeDBs, targetParentNode)
      : (shortID(targetParentRowID as ID) as ID)
  );
  const sourceRootChildContext = resolvedSemanticContext.push(
    shortID(resolvedItemID)
  );
  const targetRootChildContext = targetRootContext.push(
    shortID(resolvedItemID)
  );

  if (!resolvedNode) {
    throw new Error("Cannot deep copy a row without a concrete source node");
  }

  const [planWithCopiedNodes, mapping] = planCopyDescendantNodes(
    planWithParent,
    resolvedNode,
    (node) => {
      const isRootNode = node.id === resolvedNode.id;
      const sourceNodeContext = getNodeContext(
        planWithParent.knowledgeDBs,
        node
      );
      return isRootNode
        ? targetRootContext
        : targetRootChildContext.concat(
            sourceNodeContext.skip(sourceRootChildContext.size)
          );
    },
    undefined,
    targetParentNode.id,
    undefined,
    targetParentNode.root
  );

  const copiedTopNodeID = mapping.get(resolvedNode.id);
  if (!copiedTopNodeID) {
    return [planWithCopiedNodes, mapping];
  }

  const [finalPlan] = planAddToParent(
    planWithCopiedNodes,
    copiedTopNodeID,
    targetParentViewPath,
    stack,
    insertAtIndex,
    relevance,
    argument
  );

  return [finalPlan, mapping];
}

export function planDeepCopyNodeWithView(
  plan: Plan,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const [planWithCopy, nodesIdMapping] = planDeepCopyNode(
    plan,
    sourceViewPath,
    targetParentViewPath,
    stack,
    insertAtIndex
  );

  const nodes = getNodeForView(planWithCopy, targetParentViewPath, stack);
  if (!nodes || nodes.children.size === 0) {
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

/**
 * Create a new node value for insertion into the current node tree.
 */
export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  const userPublicKey = decodePublicKeyInputSync(text);
  const node: TextSeed = {
    id: text as ID,
    text,
    ...(userPublicKey ? { userPublicKey } : {}),
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
};

function planCreateNoteAtRoot(
  plan: Plan,
  text: string,
  viewPath: ViewPath
): SaveNodeResult {
  const [planWithSeed, createdSeed] = planCreateNode(plan, text);
  const createdNode = withUsersEntryPublicKey(
    newNode(createdSeed.text, List<ID>(), plan.user.publicKey),
    createdSeed.text
  );
  const planWithNode = planUpsertNodes(planWithSeed, createdNode);

  const paneIndex = getPaneIndex(viewPath);
  const newPanes = planWithNode.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          stack: [getSemanticID(planWithNode.knowledgeDBs, createdNode)],
          rootNodeId: createdNode.id,
        }
      : p
  );

  const resultPlan = planUpdatePanes(planWithNode, newPanes);
  const newViewPath: ViewPath = [paneIndex, createdNode.id];

  return { plan: resultPlan, viewPath: newViewPath };
}

/**
 * Save node text - either materialize an empty node or create a version for existing node.
 * Returns the updated plan and the viewPath of the saved node.
 */
export function planSaveNodeAndEnsureNodes(
  plan: Plan,
  text: string,
  viewPath: ViewPath,
  stack: ID[],
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const trimmedText = text.trim();
  const [itemID] = getRowIDFromView(plan, viewPath);
  const currentNode = getNodeForView(plan, viewPath, stack);
  const parentPath = getParentView(viewPath);

  if (isEmptySemanticID(itemID)) {
    if (!parentPath) {
      if (!trimmedText) return { plan, viewPath };
      return planCreateNoteAtRoot(plan, trimmedText, viewPath);
    }
    const nodes = getNodeForView(plan, parentPath, stack);

    if (!trimmedText) {
      const resultPlan = nodes
        ? planRemoveEmptyNodePosition(plan, nodes.id)
        : plan;
      return { plan: resultPlan, viewPath };
    }

    const [planWithNode, createdNode] = planCreateNode(plan, trimmedText);

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = nodes ? emptyNodeMetadata.get(nodes.id) : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = nodes
      ? planRemoveEmptyNodePosition(planWithNode, nodes.id)
      : planWithNode;

    const [resultPlan] = planAddToParent(
      planWithoutEmpty,
      createdNode,
      parentPath,
      stack,
      emptyNodeIndex,
      relevance ?? metadata?.nodeItem.relevance,
      argument ?? metadata?.nodeItem.argument
    );
    return { plan: resultPlan, viewPath };
  }

  const currentItem = getNode(plan.knowledgeDBs, itemID, plan.user.publicKey);
  if ((currentItem && isRefNode(currentItem)) || isSearchId(itemID as ID)) {
    return { plan, viewPath };
  }

  const displayText = currentNode ? nodeText(currentNode) : "";

  if (trimmedText === displayText) return { plan, viewPath };

  return {
    plan: currentNode
      ? planUpdateNodeText(plan, viewPath, stack, trimmedText)
      : plan,
    viewPath,
  };
}

export function getNextInsertPosition(
  plan: Plan,
  viewPath: ViewPath,
  nodeIsRoot: boolean,
  nodeIsExpanded: boolean,
  nodeIndex: number | undefined
): [ViewPath, ID[], number] | null {
  const paneIndex = viewPath[0];
  const { stack } = plan.panes[paneIndex];

  if (nodeIsRoot || nodeIsExpanded) {
    return [viewPath, stack, 0];
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) return null;

  return [parentPath, stack, (nodeIndex ?? 0) + 1];
}

export function replaceUnauthenticatedUser<T extends string>(
  from: T,
  publicKey: string
): T {
  // TODO: This feels quite dangerous
  return from.replaceAll(UNAUTHENTICATED_USER_PK, publicKey) as T;
}

function rewriteIDs(event: UnsignedEvent): UnsignedEvent {
  const replacedTags = event.tags.map((tag) =>
    tag.map((t) => replaceUnauthenticatedUser(t, event.pubkey))
  );
  return {
    ...event,
    content: replaceUnauthenticatedUser(event.content, event.pubkey),
    tags: replacedTags,
  };
}

export function planRewriteUnpublishedEvents(
  plan: Plan,
  events: List<UnsignedEvent>
): Plan {
  const allEvents = plan.publishEvents.concat(events);
  const rewrittenEvents = allEvents.map((event) =>
    rewriteIDs({
      ...event,
      pubkey: plan.user.publicKey,
    })
  );
  return {
    ...plan,
    publishEvents: rewrittenEvents,
  };
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
export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  const author = plan.user.publicKey;
  const userDB = plan.knowledgeDBs.get(author, newDB());
  const withUpserts = plan.affectedRoots.reduce((events, rootId) => {
    const rootNode = userDB.nodes.find(
      (r) =>
        !r.parent &&
        (r.id === rootId ||
          shortID(r.id) === rootId ||
          r.root === rootId ||
          r.root === shortID(rootId as ID))
    );
    if (!rootNode || !rootNode.docId) {
      return events;
    }
    const document = plan.documents.get(documentKeyOf(author, rootNode.docId));
    if (!document) {
      return events;
    }
    const snapshotSourceRoot =
      rootNode.basedOn && !rootNode.snapshotDTag
        ? getNode(plan.knowledgeDBs, rootNode.basedOn, author)
        : undefined;
    const sourceDocument = snapshotSourceRoot?.docId
      ? plan.documents.get(
          documentKeyOf(snapshotSourceRoot.author, snapshotSourceRoot.docId)
        )
      : undefined;
    const createdSnapshotDTag = sourceDocument
      ? `snapshot-${shortID(rootNode.id as ID)}`
      : undefined;
    const snapshotEvent = sourceDocument
      ? (buildSnapshotEventFromNodes(
          plan.knowledgeDBs,
          author,
          createdSnapshotDTag as string,
          sourceDocument
        ) as UnsignedEvent & EventAttachment)
      : undefined;
    const event = buildDocumentEvent(plan.knowledgeDBs, document, {
      snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
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
      pubkey: author,
      created_at: newTimestamp(),
      tags: [
        ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${docId}`],
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
  };
}

export function usePlanner(): Planner {
  const data = useData();
  const relays = useRelaysToCreatePlan();
  const createPlanningContext = (): Plan => {
    return createPlan({
      ...data,
      relays,
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
  parentPath: ViewPath,
  stack: ID[],
  insertIndex: number
): Plan {
  // 1. Ensure we have our own editable nodes (copies remote if needed)
  const planWithOwnNodes = upsertNodes(plan, parentPath, stack, (r) => r);

  // 2. Use planExpandNode for consistent expansion handling
  const [, parentView] = getRowIDFromView(planWithOwnNodes, parentPath);
  const planWithExpanded = planExpandNode(
    planWithOwnNodes,
    parentView,
    parentPath
  );

  const nodes = getNodeForView(planWithExpanded, parentPath, stack);
  if (!nodes) {
    return plan;
  }

  // 4. Add temporary event to show empty node at position
  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID: nodes.id,
      index: insertIndex,
      nodeItem: {
        children: List<ID>(),
        id: EMPTY_SEMANTIC_ID,
        spans: plainSpans(""),
        parent: nodes.id,
        updated: Date.now(),
        author: plan.user.publicKey,
        root: nodes.root,
        relevance: undefined,
      },
      paneIndex: getPaneIndex(parentPath),
    }),
  };
}

export function planUpdateEmptyNodeMetadata(
  plan: Plan,
  nodeID: LongID,
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
