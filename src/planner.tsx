/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useRef } from "react";
import { List, Map, OrderedSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DEPOSIT,
  newTimestamp,
  msTag,
} from "./nostr";
import { useData } from "./DataContext";
import { useExecutor } from "./ExecutorContext";
import { Document as KnowstrDocument, documentKeyOf } from "./core/Document";
import { renderDocumentMarkdown } from "./documentRenderer";
import {
  buildDepositEvent,
  buildDocumentEvent,
  buildSnapshotEvent,
  depositWriteRelayConf,
  snapshotIdForContent,
} from "./nodesDocumentEvent";
import { publishStateOf } from "./core/knowstrFrontmatter";
import { newStorageKey } from "./storageEncryption";
import {
  EMPTY_NODE_ID,
  isEmptyNodeID,
  getNode,
  computeEmptyNodeMetadata,
  isSearchId,
} from "./core/connections";
import type { TextSeed } from "./core/connections";
import {
  AddToParentTarget,
  GraphPlan,
  createGraphPlan,
  planAddTargetsToNode,
  planClearDocumentPublishState,
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
import { plainSpans, spansText, spansToMarkdown } from "./core/nodeSpans";
import { calendarEntryEditedSpans } from "./core/ical";
import { LOCAL } from "./core/nodeRef";
import { entityIdForText } from "./core/entityRecognition";
import { getWorkspaceNode, newDB } from "./core/knowledge";
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
  const node = newGraphNode(spans, {
    root: parentNode.root,
    parent: parentNode.id,
    relevance,
    argument,
  });
  return planAddToParent(
    planUpsertNodes(plan, node),
    node.id,
    parentNode.id,
    insertAtIndex,
    relevance,
    argument
  )[0];
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
    plan.knowledgeDBs.get(pane.sourceId, newDB()),
    sourceNode
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
  sourceId: SourceId,
  resolvedNode: GraphNode,
  targetParentID: ID,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): Plan {
  const targetParentNode = getWorkspaceNode(plan.knowledgeDBs, targetParentID);
  if (!targetParentNode) {
    return plan;
  }
  const [planWithCopiedNodes, mapping] = planCopyDescendantNodes(
    plan,
    plan.knowledgeDBs.get(sourceId, newDB()),
    resolvedNode,
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
    targetParentID,
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

  const createdNode = withDocumentRoot(
    newGraphNode(spans, entityId ? { uuid: entityId } : {})
  );
  const planWithNode = planUpsertNodes(plan, createdNode);

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

// Filter out empty placeholder nodes from events before publishing
// Empty nodes are injected at read time via injectEmptyNodesIntoKnowledgeDBs,
// so any nodes modification will include them - we need to filter before publishing
function resolveBasedOnNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID,
  myself: SourceId
): { node: GraphNode; sourceId: SourceId } | undefined {
  const own = getNode(knowledgeDBs, nodeID, myself);
  if (own) {
    return { node: own, sourceId: myself };
  }
  return knowledgeDBs
    .keySeq()
    .sort()
    .map((sourceId) => {
      const node = getNode(knowledgeDBs, nodeID, sourceId);
      return node ? { node, sourceId } : undefined;
    })
    .find((resolved) => resolved !== undefined);
}

function getSnapshotSourceRoot(
  knowledgeDBs: KnowledgeDBs,
  snapshotAnchorNode: GraphNode | undefined,
  fallbackAuthor: SourceId
): { node: GraphNode; sourceId: SourceId } | undefined {
  if (!snapshotAnchorNode?.basedOn) {
    return undefined;
  }
  const source = resolveBasedOnNode(
    knowledgeDBs,
    snapshotAnchorNode.basedOn,
    fallbackAuthor
  );
  const root = source
    ? getNode(knowledgeDBs, source.node.root, source.sourceId)
    : undefined;
  return root && source ? { node: root, sourceId: source.sourceId } : undefined;
}

// Every node of the document holding basedOn without a baseline — the fork
// shape is irrelevant (root fork, child fork, fork into another document)
// and so is the fork's age: the same predicate captures fresh forks and
// repairs legacy ones at their next save. Existing snapshotIds are never
// touched (absence is repaired, breakage is waited out).
function collectUnbaselinedForks(
  knowledgeDBs: KnowledgeDBs,
  topNodes: readonly GraphNode[]
): GraphNode[] {
  type Acc = { seen: Map<ID, boolean>; forks: GraphNode[] };
  const visit = (acc: Acc, node: GraphNode): Acc => {
    if (acc.seen.get(node.id)) {
      return acc;
    }
    const withSelf: Acc = {
      seen: acc.seen.set(node.id, true),
      forks:
        node.basedOn && !node.snapshotId ? [...acc.forks, node] : acc.forks,
    };
    return node.children.reduce((childAcc, childID) => {
      const child = getNode(knowledgeDBs, childID, LOCAL);
      return child ? visit(childAcc, child) : childAcc;
    }, withSelf);
  };
  return topNodes.reduce(visit, {
    seen: Map<ID, boolean>(),
    forks: [] as GraphNode[],
  }).forks;
}

export function buildDocumentWrites(plan: GraphPlan): {
  document: KnowstrDocument;
  content: string;
  snapshotContents: string[];
}[] {
  return plan.affectedDocuments.toArray().flatMap((docId) => {
    const document = plan.documents.get(documentKeyOf(LOCAL, docId));
    if (!document) {
      return [];
    }
    const topNodes = document.topNodeShortIds
      .map((topNodeShortId) =>
        plan.knowledgeDBs.get(LOCAL)?.nodes.get(topNodeShortId)
      )
      .filter((node): node is GraphNode => node !== undefined);
    const forkNodes = collectUnbaselinedForks(plan.knowledgeDBs, topNodes);
    // One snapshot per source document, however many forks came from it;
    // forks from several sources stamp several snapshotIds in one write.
    const baselines = forkNodes.reduce(
      (acc, forkNode) => {
        const sourceRoot = getSnapshotSourceRoot(
          plan.knowledgeDBs,
          forkNode,
          LOCAL
        );
        const sourceDocKey = sourceRoot?.node.docId
          ? documentKeyOf(sourceRoot.sourceId, sourceRoot.node.docId)
          : undefined;
        const sourceDocument = sourceDocKey
          ? plan.documents.get(sourceDocKey)
          : undefined;
        if (!sourceDocKey || !sourceDocument) {
          return acc;
        }
        const content =
          acc.contentByDoc.get(sourceDocKey) ??
          renderDocumentMarkdown(plan.knowledgeDBs, sourceDocument);
        return {
          contentByDoc: acc.contentByDoc.set(sourceDocKey, content),
          snapshotIds: acc.snapshotIds.set(
            forkNode.id,
            snapshotIdForContent(content)
          ),
        };
      },
      { contentByDoc: Map<string, string>(), snapshotIds: Map<ID, string>() }
    );
    return [
      {
        document,
        content: renderDocumentMarkdown(plan.knowledgeDBs, document, {
          snapshotIds: baselines.snapshotIds,
        }),
        snapshotContents: [
          ...baselines.contentByDoc.valueSeq().toArray(),
          ...(plan.extraSnapshots?.toArray() ?? []),
        ],
      },
    ];
  });
}

// Published, unpaused documents emit a deposit: same content as storage,
// kind 34774, entity-tagged, with per-event relay routing. Paused documents
// emit none, so the paused flag never reaches a deposit.
function depositEventFor(
  plan: GraphPlan,
  pubkey: PublicKey,
  write: { document: KnowstrDocument; content: string }
): (UnsignedEvent & EventAttachment) | undefined {
  const publishState = publishStateOf(write.document.frontMatter);
  return publishState && !publishState.paused
    ? ({
        ...buildDepositEvent(write.document, pubkey, write.content),
        writeRelayConf: depositWriteRelayConf(
          write.document,
          plan.relays.userRelays
        ),
      } as UnsignedEvent & EventAttachment)
    : undefined;
}

// Deposits alone — publication is storage-independent, so executors whose
// storage isn't relay-backed (the desktop's filesystem) publish exactly
// these and nothing else.
export function buildDepositEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  if (!plan.user) {
    return List();
  }
  const pubkey = plan.user.publicKey;
  return buildDocumentWrites(plan).reduce((events, write) => {
    const deposit = depositEventFor(plan, pubkey, write);
    return deposit ? events.push(deposit) : events;
  }, List<UnsignedEvent & EventAttachment>());
}

// Undo publishing (idea.md, M7 retract): a kind-5 on the deposit
// coordinate PLUS an empty replacement at the same (pubkey, d) — relays
// that ignore deletion requests still lose content and rendezvous — and
// the document drops knowstr_publish. Copies and takes others made remain
// theirs; that is the honest limit of retraction.
export function planRetractDocument<T extends GraphPlan>(
  plan: T,
  document: KnowstrDocument
): T {
  if (!plan.user) {
    return plan;
  }
  const pubkey = plan.user.publicKey;
  const writeRelayConf = depositWriteRelayConf(
    document,
    plan.relays.userRelays
  );
  const retraction = {
    kind: KIND_DELETE,
    pubkey,
    created_at: newTimestamp(),
    tags: [
      ["a", `${KIND_KNOWLEDGE_DEPOSIT}:${pubkey}:${document.docId}`],
      ["k", `${KIND_KNOWLEDGE_DEPOSIT}`],
      msTag(),
    ],
    content: "",
    writeRelayConf,
  };
  const emptyReplacement = {
    kind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey,
    created_at: newTimestamp(),
    tags: [["d", document.docId], msTag()],
    content: "",
    writeRelayConf,
  };
  const cleared = planClearDocumentPublishState(plan, document.docId);
  return {
    ...cleared,
    publishEvents: cleared.publishEvents.push(retraction, emptyReplacement),
  };
}

export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  if (!plan.user) {
    return plan.publishEvents;
  }
  const pubkey = plan.user.publicKey;
  const withUpserts = buildDocumentWrites(plan).reduce((events, write) => {
    // One storage key per write, shared by the document and its fork
    // snapshots: whoever can open the fork can diff against its baseline.
    const documentWithKey = {
      ...write.document,
      storageKey: write.document.storageKey ?? newStorageKey(),
    };
    const event = buildDocumentEvent(documentWithKey, pubkey, write.content);
    const depositEvent = depositEventFor(plan, pubkey, write);
    const withSnapshots = write.snapshotContents.reduce(
      (acc, snapshotContent) =>
        acc.push(
          buildSnapshotEvent(
            pubkey,
            snapshotContent,
            documentWithKey.storageKey
          )
        ),
      events
    );
    const withDocument = withSnapshots.push(event);
    return depositEvent ? withDocument.push(depositEvent) : withDocument;
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
