import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Map } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_LIST,
  KIND_KNOWLEDGE_NODE,
  KIND_CONTACTLIST,
  KIND_VIEWS,
  KIND_MEMBERLIST,
  KIND_RELAY_METADATA_EVENT,
  newTimestamp,
  msTag,
} from "./nostr";
import { useData } from "./DataContext";
import { execute, republishEvents } from "./executor";
import { useApis } from "./Apis";
import { createPublishQueue } from "./PublishQueue";
import type { StashmapDB } from "./indexedDB";
import { viewDataToJSON } from "./serializer";
import { newDB } from "./knowledge";
import {
  shortID,
  newNode,
  addRelationToRelations,
  moveRelations,
  bulkAddRelations,
  VERSIONS_NODE_ID,
  EMPTY_NODE_ID,
  isEmptyNodeID,
  getRelationsNoReferencedBy,
  computeEmptyNodeMetadata,
  isConcreteRefId,
  parseConcreteRefId,
  isAbstractRefId,
  parseAbstractRefId,
  createAbstractRefId,
  LOG_NODE_ID,
} from "./connections";
import {
  newRelations,
  getVersionsContext,
  getVersionsRelations,
  upsertRelations,
  ViewPath,
  NodeIndex,
  getNodeIDFromView,
  updateView,
  contextsMatch,
  getContext,
  getParentView,
  getNodeFromID,
  getVersionedDisplayText,
  bulkUpdateViewPathsAfterAddRelation,
  getDescendantRelations,
  copyViewsWithRelationsMapping,
  viewPathToString,
  getRelationForView,
  addNodeToPathWithRelations,
  getRelationsForContext,
  isRoot,
  getPaneIndex,
} from "./ViewContext";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { useRelaysToCreatePlan } from "./relays";
import { mergePublishResultsOfEvents } from "./commons/PublishingStatus";

export function getPane(plan: Plan | Data, viewPath: ViewPath): Pane {
  const paneIndex = viewPath[0];
  return plan.panes[paneIndex];
}

export type Plan = Data & {
  publishEvents: List<UnsignedEvent & EventAttachment>;
  relays: AllRelays;
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
};

function newContactListEvent(contacts: Contacts, user: User): UnsignedEvent {
  const tags = contacts
    .valueSeq()
    .toArray()
    .map((c) => {
      if (c.mainRelay && c.userName) {
        return ["p", c.publicKey, c.mainRelay, c.userName];
      }
      if (c.mainRelay) {
        return ["p", c.publicKey, c.mainRelay];
      }
      if (c.userName) {
        return ["p", c.publicKey, c.userName];
      }
      return ["p", c.publicKey];
    });
  return {
    kind: KIND_CONTACTLIST,
    pubkey: user.publicKey,
    created_at: newTimestamp(),
    tags: [...tags, msTag()],
    content: "",
  };
}

function setRelayConf(
  event: UnsignedEvent,
  conf: WriteRelayConf
): UnsignedEvent & EventAttachment {
  return {
    ...event,
    writeRelayConf: conf,
  };
}

export function planAddContact(plan: Plan, publicKey: PublicKey): Plan {
  if (plan.contacts.has(publicKey)) {
    return plan;
  }
  const newContact: Contact = {
    publicKey,
  };
  const newContacts = plan.contacts.set(publicKey, newContact);
  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(
      setRelayConf(contactListEvent, {
        defaultRelays: false,
        user: true,

        contacts: false,
      })
    ),
  };
}

export function planUpsertMemberlist(plan: Plan, members: Members): Plan {
  const votesTags = members
    .valueSeq()
    .toArray()
    .map((v) => ["votes", v.publicKey, `${v.votes}`]);
  const contactListEvent = newContactListEvent(members, plan.user);
  const memberListEvent = {
    ...contactListEvent,
    kind: KIND_MEMBERLIST,
    tags: [...contactListEvent.tags, ...votesTags],
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(
      setRelayConf(memberListEvent, {
        defaultRelays: false,
        user: false,

        contacts: false,
      })
    ),
  };
}

export function planAddContacts(plan: Plan, publicKeys: List<PublicKey>): Plan {
  const newContacts = publicKeys.reduce((rdx, publicKey) => {
    if (rdx.has(publicKey)) {
      return rdx;
    }
    const newContact: Contact = {
      publicKey,
    };
    return rdx.set(publicKey, newContact);
  }, plan.contacts);

  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(contactListEvent),
  };
}

export function planRemoveContact(plan: Plan, publicKey: PublicKey): Plan {
  const contactToRemove = plan.contacts.get(publicKey);
  if (!contactToRemove) {
    return plan;
  }
  const newContacts = plan.contacts.remove(publicKey);
  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(contactListEvent),
  };
}

function filterOldReplaceableEvent(
  publishEvents: List<UnsignedEvent & EventAttachment>,
  kind: number,
  dTagValue: string
): List<UnsignedEvent & EventAttachment> {
  return publishEvents.filterNot(
    (event) =>
      event.kind === kind &&
      event.tags.some((tag) => tag[0] === "d" && tag[1] === dTagValue)
  );
}

export function planUpsertRelations(plan: Plan, relations: Relations): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedRelations = userDB.relations.set(
    shortID(relations.id),
    relations
  );
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  const itemsAsTags = relations.items.toArray().map((item) => {
    const relevanceStr = item.relevance ?? "";
    return item.argument
      ? ["i", item.nodeID, relevanceStr, item.argument]
      : ["i", item.nodeID, relevanceStr];
  });
  const contextTags = relations.context.toArray().map((id) => ["c", id]);
  const basedOnTag = relations.basedOn ? [["b", relations.basedOn]] : [];
  const dTag = shortID(relations.id);
  const updateRelationsEvent = {
    kind: KIND_KNOWLEDGE_LIST,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["d", dTag],
      ["k", shortID(relations.head)],
      ["head", relations.head],
      ...contextTags,
      ...basedOnTag,
      ...itemsAsTags,
      msTag(),
    ],
    content: "",
  };
  const deduped = filterOldReplaceableEvent(
    plan.publishEvents,
    KIND_KNOWLEDGE_LIST,
    dTag
  );
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    publishEvents: deduped.push(updateRelationsEvent),
  };
}

export function planUpsertNode(plan: Plan, node: KnowNode): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.set(shortID(node.id), node);
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const dTag = shortID(node.id);
  const updateNodeEvent = {
    kind: KIND_KNOWLEDGE_NODE,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [["d", dTag], msTag()],
    content: node.text,
  };
  const deduped = filterOldReplaceableEvent(
    plan.publishEvents,
    KIND_KNOWLEDGE_NODE,
    dTag
  );
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    publishEvents: deduped.push(updateNodeEvent),
  };
}

export function planBulkUpsertNodes(plan: Plan, nodes: KnowNode[]): Plan {
  return nodes.reduce((p, node) => planUpsertNode(p, node), plan);
}

/**
 * Create a version for a node instead of modifying it directly.
 * Adds the new version to ~Versions in context [...context, originalNodeID].
 * If the version already exists in ~Versions, moves it to the top instead of adding a duplicate.
 * Also ensures the original node ID is in ~Versions (for complete version history).
 *
 * Nested version handling: If editing a node that's inside a ~Versions list,
 * adds the new version as a sibling instead of creating recursive ~Versions.
 *
 * Example: Editing BCN inside Barcelona's ~Versions:
 *   Tree: ROOT → Barcelona → ~Versions → BCN
 *   editContext = [ROOT, Barcelona, VERSIONS_NODE_ID]
 *   - originalNodeID = Barcelona (context.get(-2), the node that owns ~Versions)
 *   - context = [ROOT] (slice(0, -2), Barcelona's context without Barcelona or ~Versions)
 *   - versionsContext = [ROOT, Barcelona] (used to look up the ~Versions relation)
 */
export function planCreateVersion(
  plan: Plan,
  editedNodeID: ID,
  newText: string,
  editContext: List<ID>
): Plan {
  // Handle nested versions: if editing a node inside ~Versions list,
  // add the new version as a sibling instead of creating recursive ~Versions
  const isInsideVersions = editContext.last() === VERSIONS_NODE_ID;

  const [originalNodeID, context]: [ID, List<ID>] =
    isInsideVersions && editContext.size >= 2
      ? [
          editContext.get(editContext.size - 2) as ID, // The node that owns ~Versions
          editContext.slice(0, -2).toList(), // Context to that node
        ]
      : [editedNodeID, editContext];

  // 1. Create new version node
  const versionNode = newNode(newText);
  const planWithVersionNode = planUpsertNode(plan, versionNode);

  // 2. Ensure ~Versions node exists
  const versionsNode = newNode("~Versions");
  const updatedPlan = planUpsertNode(planWithVersionNode, versionsNode);

  // 3. Get or create ~Versions relations
  const versionsContext = getVersionsContext(originalNodeID, context);
  const baseVersionsRelations =
    getVersionsRelations(
      updatedPlan.knowledgeDBs,
      updatedPlan.user.publicKey,
      originalNodeID,
      context
    ) ||
    newRelations(VERSIONS_NODE_ID, versionsContext, updatedPlan.user.publicKey);

  // 4. Ensure original node ID is in ~Versions (add at end if not present)
  const originalIndex = baseVersionsRelations.items.findIndex(
    (item) => item.nodeID === originalNodeID
  );
  const versionsWithOriginal =
    originalIndex < 0
      ? addRelationToRelations(
          baseVersionsRelations,
          originalNodeID,
          undefined,
          undefined,
          baseVersionsRelations.items.size
        )
      : baseVersionsRelations;

  // 5. Determine insert position
  // If editing inside ~Versions, insert at the same position as the edited node
  // Otherwise, insert at position 0 (top)
  const editedNodePosition = isInsideVersions
    ? versionsWithOriginal.items.findIndex(
        (item) => item.nodeID === editedNodeID
      )
    : -1;
  const insertPosition = editedNodePosition >= 0 ? editedNodePosition : 0;

  // 6. Check if new version already exists in ~Versions
  const existingIndex = versionsWithOriginal.items.findIndex(
    (item) => item.nodeID === versionNode.id
  );

  const withVersion =
    existingIndex >= 0
      ? moveRelations(versionsWithOriginal, [existingIndex], insertPosition)
      : addRelationToRelations(
          versionsWithOriginal,
          versionNode.id,
          undefined,
          undefined,
          insertPosition
        );

  return planUpsertRelations(updatedPlan, withVersion);
}

function removeEmptyNodeFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  publicKey: PublicKey,
  relationsID: LongID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(publicKey);
  if (!myDB) {
    return knowledgeDBs;
  }

  const shortRelationsID = relationsID.includes("_")
    ? relationsID.split("_")[1]
    : relationsID;
  const existingRelations = myDB.relations.get(shortRelationsID);
  if (!existingRelations) {
    return knowledgeDBs;
  }

  const filteredItems = existingRelations.items.filter(
    (item) => !isEmptyNodeID(item.nodeID)
  );
  if (filteredItems.size === existingRelations.items.size) {
    return knowledgeDBs;
  }

  const updatedRelations = myDB.relations.set(shortRelationsID, {
    ...existingRelations,
    items: filteredItems,
  });
  return knowledgeDBs.set(publicKey, {
    ...myDB,
    relations: updatedRelations,
  });
}

function planPublishViews(plan: Plan, views: Views): Plan {
  const publishEvents = plan.publishEvents.filterNot(
    (event) => event.kind === KIND_VIEWS
  );
  const writeViewEvent = {
    kind: KIND_VIEWS,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [msTag()],
    content: JSON.stringify(viewDataToJSON(views, [])),
  };
  return {
    ...plan,
    views,
    publishEvents: publishEvents.push(
      setRelayConf(writeViewEvent, {
        defaultRelays: false,
        user: true,
        contacts: false,
      })
    ),
  };
}

export function planUpdateViews(plan: Plan, views: Views): Plan {
  return planPublishViews(plan, views);
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

export function planRemoveEmptyNodePosition(
  plan: Plan,
  relationsID: LongID
): Plan {
  return {
    ...plan,
    knowledgeDBs: removeEmptyNodeFromKnowledgeDBs(
      plan.knowledgeDBs,
      plan.user.publicKey,
      relationsID
    ),
    temporaryEvents: plan.temporaryEvents.push({
      type: "REMOVE_EMPTY_NODE",
      relationsID,
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
  nodeIDs: LongID | ID | (LongID | ID)[],
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): Plan {
  const nodeIDsArray = Array.isArray(nodeIDs) ? nodeIDs : [nodeIDs];
  if (nodeIDsArray.length === 0) {
    return plan;
  }

  const [, parentView] = getNodeIDFromView(plan, parentViewPath);
  const planWithExpand = planExpandNode(plan, parentView, parentViewPath);

  const updatedRelationsPlan = upsertRelations(
    planWithExpand,
    parentViewPath,
    stack,
    (relations) =>
      bulkAddRelations(
        relations,
        nodeIDsArray,
        relevance,
        argument,
        insertAtIndex
      )
  );

  const updatedViews = bulkUpdateViewPathsAfterAddRelation(
    updatedRelationsPlan,
    parentViewPath,
    stack as ID[],
    nodeIDsArray.length,
    insertAtIndex
  );

  return planUpdateViews(updatedRelationsPlan, updatedViews);
}

type RelationsIdMapping = Map<LongID, LongID>;

function planCopyDescendantRelations(
  plan: Plan,
  sourceNodeID: LongID | ID,
  sourceContext: Context,
  transformContext: (relation: Relations) => Context,
  filterRelation?: (relation: Relations) => boolean,
  sourceRelation?: Relations
): [Plan, RelationsIdMapping] {
  const allDescendants = getDescendantRelations(
    plan.knowledgeDBs,
    sourceNodeID,
    sourceContext
  ).filter(filterRelation ?? (() => true));
  const descendants: List<Relations> = sourceRelation
    ? allDescendants
        .filter(
          (r) =>
            r.head !== sourceRelation.head ||
            !contextsMatch(r.context, sourceRelation.context)
        )
        .push(sourceRelation)
    : allDescendants;

  return descendants.reduce(
    ([accPlan, accMapping], relation) => {
      const newContext = transformContext(relation);
      const baseRelation = newRelations(
        relation.head,
        newContext,
        accPlan.user.publicKey
      );
      const newRelation: Relations = {
        ...baseRelation,
        items: relation.items,
      };

      return [
        planUpsertRelations(accPlan, newRelation),
        accMapping.set(relation.id, newRelation.id),
      ] as [Plan, RelationsIdMapping];
    },
    [plan, Map<LongID, LongID>()] as [Plan, RelationsIdMapping]
  );
}

function updateViewsWithRelationsMapping(
  views: Views,
  relationsIdMapping: Map<LongID, LongID>
): Views {
  return views.mapEntries(([key, view]) => {
    const newKey = relationsIdMapping.reduce(
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
  const context = getContext(plan, viewPath, stack);
  const entryNodeID = context.first();
  if (!entryNodeID) {
    return plan;
  }
  const entryContext = List<ID>();
  const [planWithRelations, relationsIdMapping] = planCopyDescendantRelations(
    plan,
    entryNodeID,
    entryContext,
    (relation) => relation.context,
    (relation) => relation.author === pane.author
  );
  const updatedViews = updateViewsWithRelationsMapping(
    planWithRelations.views,
    relationsIdMapping
  );
  const planWithUpdatedViews = planUpdateViews(planWithRelations, updatedViews);
  const paneIndex = viewPath[0];
  const newPanes = planWithUpdatedViews.panes.map((p, i) =>
    i === paneIndex
      ? { ...p, author: plan.user.publicKey, rootRelation: undefined }
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
): [Plan, RelationsIdMapping] {
  const [sourceNodeID] = getNodeIDFromView(plan, sourceViewPath);
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceContext = getContext(plan, sourceViewPath, sourceStack);
  const sourceRelation = getRelationForView(plan, sourceViewPath, sourceStack);

  const resolveSource = (): { nodeID: LongID | ID; context: Context } => {
    if (isConcreteRefId(sourceNodeID)) {
      const parsed = parseConcreteRefId(sourceNodeID);
      if (parsed) {
        const relation = getRelationsNoReferencedBy(
          plan.knowledgeDBs,
          parsed.relationID,
          plan.user.publicKey
        );
        if (relation) {
          return {
            nodeID: relation.head,
            context: relation.context,
          };
        }
      }
    }
    if (isAbstractRefId(sourceNodeID)) {
      const parsed = parseAbstractRefId(sourceNodeID);
      if (parsed) {
        return {
          nodeID: parsed.targetNode,
          context: parsed.targetContext,
        };
      }
    }
    return { nodeID: sourceNodeID, context: sourceContext };
  };

  const resolved = resolveSource();
  const resolvedNodeID = resolved.nodeID;
  const resolvedContext = resolved.context;

  const targetParentContext = getContext(plan, targetParentViewPath, stack);
  const [targetParentNodeID] = getNodeIDFromView(plan, targetParentViewPath);
  const nodeNewContext = targetParentContext.push(shortID(targetParentNodeID));

  const planWithNode = planAddToParent(
    plan,
    resolvedNodeID,
    targetParentViewPath,
    stack,
    insertAtIndex,
    relevance,
    argument
  );

  const [finalPlan, mapping] = planCopyDescendantRelations(
    planWithNode,
    resolvedNodeID,
    resolvedContext,
    (relation) => {
      const isDirectChildrenRelation =
        relation.head === resolvedNodeID &&
        contextsMatch(relation.context, resolvedContext);
      return isDirectChildrenRelation
        ? nodeNewContext
        : nodeNewContext.concat(relation.context.skip(resolvedContext.size));
    },
    undefined,
    sourceRelation
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
  const [planWithCopy, relationsIdMapping] = planDeepCopyNode(
    plan,
    sourceViewPath,
    targetParentViewPath,
    stack,
    insertAtIndex
  );

  const relations = getRelationForView(
    planWithCopy,
    targetParentViewPath,
    stack
  );
  if (!relations || relations.items.size === 0) {
    return planWithCopy;
  }

  const targetIndex = insertAtIndex ?? relations.items.size - 1;
  const targetViewPath = addNodeToPathWithRelations(
    targetParentViewPath,
    relations,
    targetIndex
  );

  const sourceKey = viewPathToString(sourceViewPath);
  const targetKey = viewPathToString(targetViewPath);

  const updatedViews = copyViewsWithRelationsMapping(
    planWithCopy.views,
    sourceKey,
    targetKey,
    relationsIdMapping
  );

  return planUpdateViews(planWithCopy, updatedViews);
}

/**
 * Create a new node and add it to the plan, handling version awareness.
 * If the node (by content-addressed ID) already has ~Versions in this context,
 * ensures the typed text becomes the active version.
 *
 * @param plan - The current plan
 * @param text - The text for the new node
 * @param context - The context where the node will be added (should include parent's ID)
 * @returns [updatedPlan, newNode] - The updated plan and the created node
 */
export function planCreateNode(plan: Plan, text: string): [Plan, KnowNode] {
  const node = newNode(text);
  const planWithNode = planUpsertNode(plan, node);
  return [planWithNode, node];
}

function ensureLogNode(plan: Plan): Plan {
  const existingLog = getNodeFromID(
    plan.knowledgeDBs,
    LOG_NODE_ID,
    plan.user.publicKey
  );
  if (existingLog) {
    return plan;
  }
  const logNode: KnowNode = {
    id: LOG_NODE_ID,
    text: "~Log",
    type: "text",
  };
  return planUpsertNode(plan, logNode);
}

export type SaveNodeResult = {
  plan: Plan;
  viewPath: ViewPath;
};

function planCreateNoteAtRoot(
  plan: Plan,
  text: string,
  viewPath: ViewPath
): SaveNodeResult {
  const [planWithNode, createdNode] = planCreateNode(plan, text);
  const planWithLog = ensureLogNode(planWithNode);

  const logRelations = getRelationsForContext(
    planWithLog.knowledgeDBs,
    planWithLog.user.publicKey,
    LOG_NODE_ID,
    List<ID>(),
    undefined,
    false
  );

  const relations =
    logRelations || newRelations(LOG_NODE_ID, List<ID>(), plan.user.publicKey);
  const refId = createAbstractRefId(List<ID>(), createdNode.id);
  const updatedRelations = addRelationToRelations(
    relations,
    refId,
    undefined,
    undefined,
    0
  );
  const planWithRelations = planUpsertRelations(planWithLog, updatedRelations);

  const paneIndex = getPaneIndex(viewPath);
  const newPanes = planWithRelations.panes.map((p, i) =>
    i === paneIndex ? { ...p, stack: [createdNode.id] } : p
  );

  const resultPlan = planUpdatePanes(planWithRelations, newPanes);
  const newViewPath: ViewPath = [
    paneIndex,
    { nodeID: createdNode.id, nodeIndex: 0 as NodeIndex },
  ];

  return { plan: resultPlan, viewPath: newViewPath };
}

/**
 * Save node text - either materialize an empty node or create a version for existing node.
 * Returns the updated plan and the viewPath of the saved node.
 */
export function planSaveNodeAndEnsureRelations(
  plan: Plan,
  text: string,
  viewPath: ViewPath,
  stack: ID[],
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const trimmedText = text.trim();
  const [nodeID] = getNodeIDFromView(plan, viewPath);
  const parentPath = getParentView(viewPath);

  if (isEmptyNodeID(nodeID)) {
    if (!parentPath) {
      if (!trimmedText) return { plan, viewPath };
      return planCreateNoteAtRoot(plan, trimmedText, viewPath);
    }
    const [parentNodeID] = getNodeIDFromView(plan, parentPath);
    const relations = getRelationForView(plan, parentPath, stack);

    if (!trimmedText) {
      const resultPlan = relations
        ? planRemoveEmptyNodePosition(plan, relations.id)
        : plan;
      return { plan: resultPlan, viewPath };
    }

    const [planWithNode, createdNode] = planCreateNode(plan, trimmedText);

    const parentContext = getContext(plan, parentPath, stack);
    const nodeContext = parentContext.push(parentNodeID);
    const existingVersions = getVersionsRelations(
      planWithNode.knowledgeDBs,
      planWithNode.user.publicKey,
      createdNode.id,
      nodeContext
    );
    const planWithVersion = existingVersions
      ? planCreateVersion(
          planWithNode,
          createdNode.id,
          trimmedText,
          nodeContext
        )
      : planWithNode;

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = relations
      ? emptyNodeMetadata.get(relations.id)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = relations
      ? planRemoveEmptyNodePosition(planWithVersion, relations.id)
      : planWithVersion;

    const resultPlan = planAddToParent(
      planWithoutEmpty,
      createdNode.id,
      parentPath,
      stack,
      emptyNodeIndex,
      relevance ?? metadata?.relationItem.relevance,
      argument ?? metadata?.relationItem.argument
    );
    return { plan: resultPlan, viewPath };
  }

  const node = getNodeFromID(plan.knowledgeDBs, nodeID, plan.user.publicKey);
  if (!node || node.type !== "text") return { plan, viewPath };

  const context = getContext(plan, viewPath, stack);
  const displayText =
    getVersionedDisplayText(
      plan.knowledgeDBs,
      plan.user.publicKey,
      nodeID,
      context
    ) ??
    node.text ??
    "";

  if (trimmedText === displayText) return { plan, viewPath };

  return {
    plan: planCreateVersion(plan, nodeID, trimmedText, context),
    viewPath,
  };
}

export function getNextInsertPosition(
  plan: Plan,
  viewPath: ViewPath,
  nodeIsRoot: boolean,
  nodeIsExpanded: boolean,
  relationIndex: number | undefined
): [ViewPath, ID[], number] | null {
  const paneIndex = viewPath[0];
  const { stack } = plan.panes[paneIndex];

  if (nodeIsRoot || nodeIsExpanded) {
    return [viewPath, stack, 0];
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) return null;

  return [parentPath, stack, (relationIndex ?? 0) + 1];
}

function planDelete(plan: Plan, id: LongID | ID, kind: number): Plan {
  const deleteEvent = {
    kind: KIND_DELETE,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["a", `${kind}:${plan.user.publicKey}:${shortID(id)}`],
      ["k", `${kind}`],
      msTag(),
    ],
    content: "",
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(deleteEvent),
  };
}

export function planDeleteNode(plan: Plan, nodeID: LongID | ID): Plan {
  // Prevent deletion of empty placeholder node
  if (isEmptyNodeID(nodeID)) {
    return plan;
  }

  const deletePlan = planDelete(plan, nodeID, KIND_KNOWLEDGE_NODE);
  const userDB = plan.knowledgeDBs.get(deletePlan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.remove(shortID(nodeID));
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  return {
    ...deletePlan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
  };
}

export function planDeleteRelations(plan: Plan, relationsID: LongID): Plan {
  const deletePlan = planDelete(plan, relationsID, KIND_KNOWLEDGE_LIST);
  const userDB = plan.knowledgeDBs.get(deletePlan.user.publicKey, newDB());
  const updatedRelations = userDB.relations.remove(shortID(relationsID));
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  return {
    ...deletePlan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
  };
}

export function planDeleteDescendantRelations(
  plan: Plan,
  nodeID: LongID | ID,
  context: Context
): Plan {
  const descendants = getDescendantRelations(
    plan.knowledgeDBs,
    nodeID,
    context
  ).filter((r) => r.author === plan.user.publicKey);

  return descendants.reduce(
    (accPlan, relation) => planDeleteRelations(accPlan, relation.id),
    plan
  );
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

export function relayTags(relays: Relays): string[][] {
  return relays
    .map((r) => {
      if (r.read && r.write) {
        return ["r", r.url];
      }
      if (r.read) {
        return ["r", r.url, "read"];
      }
      if (r.write) {
        return ["r", r.url, "write"];
      }
      return [];
    })
    .filter((tag) => tag.length > 0);
}

export function planPublishRelayMetadata(plan: Plan, relays: Relays): Plan {
  const tags = relayTags(relays);
  const publishRelayMetadataEvent = {
    kind: KIND_RELAY_METADATA_EVENT,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [...tags, msTag()],
    content: "",
    writeRelayConf: {
      defaultRelays: true,
      user: true,
      extraRelays: relays,
    },
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(publishRelayMetadataEvent),
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
// so any relations modification will include them - we need to filter before publishing
function filterEmptyNodesFromEvents(
  events: List<UnsignedEvent & EventAttachment>
): List<UnsignedEvent & EventAttachment> {
  return events
    .map((event) => {
      if (event.kind === KIND_KNOWLEDGE_LIST) {
        // Check if head is empty node - skip entire event (shouldn't happen)
        const headTag = event.tags.find((t) => t[0] === "head");
        if (headTag && isEmptyNodeID(headTag[1])) {
          return null;
        }

        // Filter empty node items from relations
        const filteredTags = event.tags.filter((tag) => {
          if (tag[0] === "i") {
            return !isEmptyNodeID(tag[1]);
          }
          return true;
        });

        return { ...event, tags: filteredTags };
      }

      if (event.kind === KIND_KNOWLEDGE_NODE) {
        // Skip empty node events (shouldn't happen)
        if (event.content === "") {
          return null;
        }
      }

      return event;
    })
    .filter(
      (event): event is UnsignedEvent & EventAttachment => event !== null
    );
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
  setPanes,
  db,
  getRelays,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  db?: StashmapDB | null;
  getRelays?: () => AllRelays;
}): JSX.Element {
  const { relayPool, finalizeEvent } = useApis();
  const { user } = useData();

  const depsRef = useRef({
    user,
    relays: getRelays
      ? getRelays()
      : {
          defaultRelays: [] as Relays,
          userRelays: [] as Relays,
          contactsRelays: [] as Relays,
        },
    relayPool,
    finalizeEvent,
  });
  // eslint-disable-next-line functional/immutable-data
  depsRef.current = {
    user,
    relays: getRelays ? getRelays() : depsRef.current.relays,
    relayPool,
    finalizeEvent,
  };

  const setPublishEventsRef = useRef(setPublishEvents);
  // eslint-disable-next-line functional/immutable-data
  setPublishEventsRef.current = setPublishEvents;

  const queueRef = useRef<ReturnType<typeof createPublishQueue> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    if (!db) return () => {};
    const queue = createPublishQueue({
      db,
      getDeps: () => depsRef.current,
      onResults: (results) => {
        setPublishEventsRef.current((prevStatus) => ({
          ...prevStatus,
          results: mergePublishResultsOfEvents(prevStatus.results, results),
          isLoading: false,
          queueStatus: queueRef.current?.getStatus(),
        }));
      },
    });
    // eslint-disable-next-line functional/immutable-data
    queueRef.current = queue;
    queue.init().then(() => {
      setPublishEventsRef.current((prev) => ({
        ...prev,
        queueStatus: queue.getStatus(),
      }));
    });
    return () => {
      // eslint-disable-next-line functional/immutable-data
      queueRef.current = null;
      queue.destroy();
    };
  }, [db]);

  const executePlan = async (plan: Plan): Promise<void> => {
    setPanes(plan.panes);
    const filteredEvents = filterEmptyNodesFromEvents(plan.publishEvents);

    if (filteredEvents.size === 0) {
      setPublishEvents((prevStatus) => {
        const newTemporaryEvents = prevStatus.temporaryEvents.concat(
          plan.temporaryEvents
        );
        return {
          ...prevStatus,
          temporaryView: plan.temporaryView,
          temporaryEvents: newTemporaryEvents,
        };
      });
      return;
    }

    setPublishEvents((prevStatus) => {
      const newTemporaryEvents = prevStatus.temporaryEvents.concat(
        plan.temporaryEvents
      );
      return {
        unsignedEvents: prevStatus.unsignedEvents.concat(filteredEvents),
        results: prevStatus.results,
        isLoading: !queueRef.current,
        preLoginEvents: prevStatus.preLoginEvents,
        temporaryView: plan.temporaryView,
        temporaryEvents: newTemporaryEvents,
      };
    });

    if (queueRef.current) {
      queueRef.current.enqueue(filteredEvents);
      setPublishEvents((prev) => ({
        ...prev,
        queueStatus: queueRef.current?.getStatus(),
      }));
      return;
    }

    const filteredPlan = {
      ...plan,
      publishEvents: filteredEvents,
    };

    const results = await execute({
      plan: filteredPlan,
      relayPool,
      finalizeEvent,
    });

    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  const republishEventsOnRelay = async (
    events: List<Event>,
    relayUrl: string
  ): Promise<void> => {
    const results = await republishEvents({
      events,
      relayPool,
      writeRelayUrl: relayUrl,
    });
    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  return (
    <PlanningContext.Provider
      value={{
        executePlan,
        republishEvents: republishEventsOnRelay,
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
    ...props,
    publishEvents:
      props.publishEvents || List<UnsignedEvent & EventAttachment>([]),
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
  // 1. Ensure we have our own editable relations (copies remote if needed)
  const planWithOwnRelations = upsertRelations(
    plan,
    parentPath,
    stack,
    (r) => r
  );

  // 2. Use planExpandNode for consistent expansion handling
  const [parentNodeID, parentView] = getNodeIDFromView(
    planWithOwnRelations,
    parentPath
  );
  const context = getContext(plan, parentPath, stack);
  const planWithExpanded = planExpandNode(
    planWithOwnRelations,
    parentView,
    parentPath
  );

  // 3. Get relations from context using pane author (handles forked relations correctly)
  const pane = getPane(planWithExpanded, parentPath);
  const relations = getRelationsForContext(
    planWithExpanded.knowledgeDBs,
    pane.author,
    parentNodeID,
    context,
    pane.rootRelation,
    isRoot(parentPath)
  );
  if (!relations) {
    return plan;
  }

  // 4. Add temporary event to show empty node at position
  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      relationsID: relations.id,
      index: insertIndex,
      relationItem: { nodeID: EMPTY_NODE_ID, relevance: undefined },
      paneIndex: getPaneIndex(parentPath),
    }),
  };
}

export function planUpdateEmptyNodeMetadata(
  plan: Plan,
  relationsID: LongID,
  metadata: { relevance?: Relevance; argument?: Argument }
): Plan {
  const currentMetadata = computeEmptyNodeMetadata(
    plan.publishEventsStatus.temporaryEvents
  );
  const existing = currentMetadata.get(relationsID);
  if (!existing) {
    return plan;
  }

  const updatedRelationItem: RelationItem = {
    ...existing.relationItem,
    relevance: metadata.relevance ?? existing.relationItem.relevance,
    argument: metadata.argument ?? existing.relationItem.argument,
  };

  return {
    ...plan,
    temporaryEvents: plan.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      relationsID,
      index: existing.index,
      relationItem: updatedRelationItem,
      paneIndex: existing.paneIndex,
    }),
  };
}
