import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
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
import { buildDocumentEvent, WalkContext, createVersion } from "./markdownDocument";
import {
  shortID,
  newNode,
  addRelationToRelations,
  bulkAddRelations,
  EMPTY_NODE_ID,
  isEmptyNodeID,
  getRelationsNoReferencedBy,
  computeEmptyNodeMetadata,
  isConcreteRefId,
  parseConcreteRefId,
  LOG_NODE_ID,
  createConcreteRefId,
  isRefId,
  findUniqueText,
  VERSIONS_NODE_ID,
} from "./connections";
import {
  newRelations,
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
  getEffectiveAuthor,
  isRoot,
  getPaneIndex,
} from "./ViewContext";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { useRelaysToCreatePlan } from "./relays";
import { mergePublishResultsOfEvents } from "./commons/PublishingStatus";
import {
  MultiSelectionState,
  clearSelection,
  deselectAllChildren,
  shiftSelect,
  toggleSelect,
} from "./selection";

export function getPane(plan: Plan | Data, viewPath: ViewPath): Pane {
  const paneIndex = viewPath[0];
  return plan.panes[paneIndex];
}

export type Plan = Data & {
  publishEvents: List<UnsignedEvent & EventAttachment>;
  affectedRoots: ImmutableSet<ID>;
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

export function planUpsertNode(plan: Plan, node: KnowNode): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.set(shortID(node.id), node);
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
  };
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

function upsertRelationsCore(plan: Plan, relations: Relations): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedRelations = userDB.relations.set(
    shortID(relations.id),
    relations
  );
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  const affectedRoot = relations.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: plan.affectedRoots.add(affectedRoot),
  };
}

function addCrefToLog(plan: Plan, relationID: LongID): Plan {
  const planWithLog = ensureLogNode(plan);
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
  const crefId = createConcreteRefId(relationID);
  const updatedRelations = addRelationToRelations(
    relations,
    crefId,
    undefined,
    undefined,
    0
  );
  return upsertRelationsCore(planWithLog, updatedRelations);
}

export function planUpsertRelations(plan: Plan, relations: Relations): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const isNewRelation = !userDB.relations.has(shortID(relations.id));
  const basePlan = upsertRelationsCore(plan, relations);

  const isRootRelation =
    isNewRelation &&
    relations.context.size === 0 &&
    shortID(relations.head) !== LOG_NODE_ID;
  if (!isRootRelation) {
    return basePlan;
  }
  return addCrefToLog(basePlan, relations.id);
}

export function planBulkUpsertNodes(plan: Plan, nodes: KnowNode[]): Plan {
  return nodes.reduce((p, node) => planUpsertNode(p, node), plan);
}

export function planCreateVersion(
  plan: Plan,
  editedNodeID: ID,
  newText: string,
  editContext: List<ID>
): Plan {
  const ctx: WalkContext = {
    knowledgeDBs: plan.knowledgeDBs,
    publicKey: plan.user.publicKey,
    affectedRoots: plan.affectedRoots,
  };
  const result = createVersion(ctx, editedNodeID, newText, editContext);
  return { ...plan, knowledgeDBs: result.knowledgeDBs, affectedRoots: result.affectedRoots };
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

export function planDeselectTemporarySelectionInView(
  plan: Plan,
  viewKey: string
): Plan {
  const current = getTemporarySelectionState(plan);
  return planSetTemporarySelectionState(plan, {
    baseSelection: deselectAllChildren(current.baseSelection, viewKey),
    shiftSelection: deselectAllChildren(current.shiftSelection, viewKey),
    anchor: current.anchor,
  });
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


function resolveCollisions(
  plan: Plan,
  nodeIDsArray: (LongID | ID)[],
  parentViewPath: ViewPath,
  stack: ID[],
  excludeNodeIDs?: readonly ID[]
): [Plan, (LongID | ID)[]] {
  const relation = getRelationForView(plan, parentViewPath, stack);
  if (!relation) {
    return [plan, nodeIDsArray];
  }

  const [parentNodeID] = getNodeIDFromView(plan, parentViewPath);
  const parentContext = getContext(plan, parentViewPath, stack);
  const nodeContext = parentContext.push(parentNodeID);

  return nodeIDsArray.reduce<[Plan, (LongID | ID)[]]>(
    ([accPlan, accIDs], nodeID) => {
      if (isRefId(nodeID)) {
        return [accPlan, [...accIDs, nodeID]];
      }

      const alreadyExists = relation.items.some(
        (item) =>
          item.nodeID === nodeID &&
          (!excludeNodeIDs || !excludeNodeIDs.includes(item.nodeID))
      );
      const alreadyAdded = accIDs.some((id) => id === nodeID);
      if (!alreadyExists && !alreadyAdded) {
        return [accPlan, [...accIDs, nodeID]];
      }

      const node = getNodeFromID(
        accPlan.knowledgeDBs,
        nodeID,
        accPlan.user.publicKey
      );
      if (!node || node.type !== "text") {
        return [accPlan, [...accIDs, nodeID]];
      }

      const relationIDs = relation.items.map((item) => item.nodeID).toArray();
      const uniqueText = findUniqueText(node.text, relationIDs);
      const variantNode = newNode(uniqueText);
      const planWithVariant = planUpsertNode(accPlan, variantNode);
      const planWithVersion = planCreateVersion(
        planWithVariant,
        variantNode.id,
        node.text,
        nodeContext
      );
      return [planWithVersion, [...accIDs, variantNode.id]];
    },
    [plan, []]
  );
}

// excludeFromCollisions: node IDs about to be disconnected (e.g. during move),
// so they shouldn't count as existing siblings when detecting collisions.
export function planAddToParent(
  plan: Plan,
  nodeIDs: LongID | ID | (LongID | ID)[],
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument,
  excludeFromCollisions?: readonly ID[]
): [Plan, (LongID | ID)[]] {
  const nodeIDsArray = Array.isArray(nodeIDs) ? nodeIDs : [nodeIDs];
  if (nodeIDsArray.length === 0) {
    return [plan, []];
  }

  const [, parentView] = getNodeIDFromView(plan, parentViewPath);
  const planWithExpand = planExpandNode(plan, parentView, parentViewPath);

  const [planWithCollisions, resolvedIDs] = resolveCollisions(
    planWithExpand,
    nodeIDsArray,
    parentViewPath,
    stack,
    excludeFromCollisions
  );

  const updatedRelationsPlan = upsertRelations(
    planWithCollisions,
    parentViewPath,
    stack,
    (relations) =>
      bulkAddRelations(
        relations,
        resolvedIDs,
        relevance,
        argument,
        insertAtIndex
      )
  );

  const updatedViews = bulkUpdateViewPathsAfterAddRelation(
    updatedRelationsPlan,
    parentViewPath,
    stack as ID[],
    resolvedIDs.length,
    insertAtIndex
  );

  return [planUpdateViews(updatedRelationsPlan, updatedViews), resolvedIDs];
}

type RelationsIdMapping = Map<LongID, LongID>;

function planCopyDescendantRelations(
  plan: Plan,
  sourceNodeID: LongID | ID,
  sourceContext: Context,
  transformContext: (relation: Relations) => Context,
  filterRelation?: (relation: Relations) => boolean,
  sourceRelation?: Relations,
  targetNodeID?: LongID | ID,
  root?: ID
): [Plan, RelationsIdMapping] {
  const allDescendants = getDescendantRelations(
    plan.knowledgeDBs,
    sourceNodeID,
    sourceContext
  ).filter(filterRelation ?? (() => true));
  const filteredDescendants = sourceRelation
    ? allDescendants.filter(
        (r) =>
          r.head !== sourceRelation.head ||
          !contextsMatch(r.context, sourceRelation.context)
      )
    : allDescendants;
  const descendants: List<Relations> = sourceRelation
    ? List<Relations>([sourceRelation]).concat(filteredDescendants)
    : filteredDescendants;

  const [resultPlan, resultMapping] = descendants.reduce(
    ([accPlan, accMapping, accRoot], relation) => {
      const newContext = transformContext(relation);
      const head =
        targetNodeID &&
        relation.head === shortID(sourceNodeID) &&
        contextsMatch(relation.context, sourceContext)
          ? targetNodeID
          : relation.head;
      const baseRelation = newRelations(
        head,
        newContext,
        accPlan.user.publicKey,
        accRoot
      );
      const newRelation: Relations = {
        ...baseRelation,
        items: relation.items,
        basedOn: relation.id,
      };

      return [
        planUpsertRelations(accPlan, newRelation),
        accMapping.set(relation.id, newRelation.id),
        accRoot ?? newRelation.root,
      ] as [Plan, RelationsIdMapping, ID | undefined];
    },
    [plan, Map<LongID, LongID>(), root] as [
      Plan,
      RelationsIdMapping,
      ID | undefined,
    ]
  );
  return [resultPlan, resultMapping];
}

export function planMoveDescendantRelations(
  plan: Plan,
  sourceNodeID: LongID | ID,
  sourceContext: Context,
  targetContext: Context,
  sourceRelation?: Relations,
  targetNodeID?: LongID | ID,
  root?: ID
): Plan {
  const allDescendants = getDescendantRelations(
    plan.knowledgeDBs,
    sourceNodeID,
    sourceContext
  );
  const descendants: List<Relations> = sourceRelation
    ? allDescendants
        .filter(
          (r) =>
            r.head !== sourceRelation.head ||
            !contextsMatch(r.context, sourceRelation.context)
        )
        .push(sourceRelation)
    : allDescendants;

  const effectiveTargetNodeID = targetNodeID ?? sourceNodeID;
  const sourceChildContext = sourceContext.push(shortID(sourceNodeID));
  const targetChildContext = targetContext.push(shortID(effectiveTargetNodeID));

  return descendants.reduce((accPlan, relation) => {
    const isDirectChildrenRelation =
      relation.head === shortID(sourceNodeID) &&
      contextsMatch(relation.context, sourceContext);
    const newContext = isDirectChildrenRelation
      ? targetContext
      : targetChildContext.concat(
          relation.context.skip(sourceChildContext.size)
        );
    const head = isDirectChildrenRelation
      ? shortID(effectiveTargetNodeID)
      : relation.head;
    return planUpsertRelations(accPlan, {
      ...relation,
      head,
      context: newContext,
      root: root ?? relation.root,
    });
  }, plan);
}

export function planMoveTreeDescendantsToContext(
  plan: Plan,
  originalTopNodeIDs: ID[],
  actualNodeIDs: (LongID | ID)[],
  parentViewPath: ViewPath,
  stack: ID[],
  root?: ID
): Plan {
  const parentContext = getContext(plan, parentViewPath, stack);
  const [parentNodeID] = getNodeIDFromView(plan, parentViewPath);
  const targetContext = parentContext.push(shortID(parentNodeID));

  return originalTopNodeIDs.reduce((accPlan, originalID, index) => {
    const actualID = actualNodeIDs[index];
    return planMoveDescendantRelations(
      accPlan,
      originalID,
      List<ID>(),
      targetContext,
      undefined,
      actualID !== originalID ? actualID : undefined,
      root
    );
  }, plan);
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

  const rootRelationData = pane.rootRelation
    ? getRelationsNoReferencedBy(
        plan.knowledgeDBs,
        pane.rootRelation,
        pane.author || plan.user.publicKey
      )
    : undefined;

  const context = getContext(plan, viewPath, stack);
  const entryNodeID = rootRelationData
    ? (rootRelationData.head as ID)
    : context.first() || (stack[stack.length - 1] as ID);
  if (!entryNodeID) {
    return plan;
  }
  const entryContext = rootRelationData ? rootRelationData.context : List<ID>();
  const [planWithRelations, relationsIdMapping] = planCopyDescendantRelations(
    plan,
    entryNodeID,
    entryContext,
    (relation) => relation.context.slice(entryContext.size).toList(),
    (relation) => relation.author === pane.author,
    rootRelationData
  );
  const updatedViews = updateViewsWithRelationsMapping(
    planWithRelations.views,
    relationsIdMapping
  );
  const planWithUpdatedViews = planUpdateViews(planWithRelations, updatedViews);
  const paneIndex = viewPath[0];
  const newRootRelation = pane.rootRelation
    ? relationsIdMapping.get(pane.rootRelation)
    : undefined;
  const newPanes = planWithUpdatedViews.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          author: plan.user.publicKey,
          rootRelation: newRootRelation,
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
    return { nodeID: sourceNodeID, context: sourceContext };
  };

  const resolved = resolveSource();
  const resolvedNodeID = resolved.nodeID;
  const resolvedContext = resolved.context;

  const targetParentContext = getContext(plan, targetParentViewPath, stack);
  const [targetParentNodeID] = getNodeIDFromView(plan, targetParentViewPath);
  const nodeNewContext = targetParentContext.push(shortID(targetParentNodeID));

  const [planWithNode, [actualNodeID]] = planAddToParent(
    plan,
    resolvedNodeID,
    targetParentViewPath,
    stack,
    insertAtIndex,
    relevance,
    argument
  );

  const copyNodeID = actualNodeID ?? resolvedNodeID;
  const sourceChildContext = resolvedContext.push(shortID(resolvedNodeID));
  const targetChildContext = nodeNewContext.push(shortID(copyNodeID));

  const targetParentRelation = getRelationForView(
    planWithNode,
    targetParentViewPath,
    stack
  );

  const [finalPlan, mapping] = planCopyDescendantRelations(
    planWithNode,
    resolvedNodeID,
    resolvedContext,
    (relation) => {
      const isDirectChildrenRelation =
        relation.head === shortID(resolvedNodeID) &&
        contextsMatch(relation.context, resolvedContext);
      return isDirectChildrenRelation
        ? nodeNewContext
        : targetChildContext.concat(
            relation.context.skip(sourceChildContext.size)
          );
    },
    undefined,
    sourceRelation,
    copyNodeID !== resolvedNodeID ? copyNodeID : undefined,
    targetParentRelation?.root
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
 * If the node (by content-addressed ID) already has ~versions in this context,
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
  const planWithRelation = planUpsertRelations(
    planWithNode,
    newRelations(createdNode.id, List<ID>(), plan.user.publicKey)
  );

  const paneIndex = getPaneIndex(viewPath);
  const newPanes = planWithRelation.panes.map((p, i) =>
    i === paneIndex ? { ...p, stack: [createdNode.id] } : p
  );

  const resultPlan = planUpdatePanes(planWithRelation, newPanes);
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
    const relations = getRelationForView(plan, parentPath, stack);

    if (!trimmedText) {
      const resultPlan = relations
        ? planRemoveEmptyNodePosition(plan, relations.id)
        : plan;
      return { plan: resultPlan, viewPath };
    }

    const [planWithNode, createdNode] = planCreateNode(plan, trimmedText);

    const emptyNodeMetadata = computeEmptyNodeMetadata(
      plan.publishEventsStatus.temporaryEvents
    );
    const metadata = relations
      ? emptyNodeMetadata.get(relations.id)
      : undefined;
    const emptyNodeIndex = metadata?.index ?? 0;

    const planWithoutEmpty = relations
      ? planRemoveEmptyNodePosition(planWithNode, relations.id)
      : planWithNode;

    const [resultPlan] = planAddToParent(
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

function planDelete(
  plan: Plan,
  id: LongID | ID,
  kind: number,
  extraTags?: string[][]
): Plan {
  const deleteEvent = {
    kind: KIND_DELETE,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["a", `${kind}:${plan.user.publicKey}:${shortID(id)}`],
      ["k", `${kind}`],
      ...(extraTags || []),
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
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const relation = userDB.relations.get(shortID(relationsID));
  const headTag = relation ? [["head", relation.head]] : [];
  const contextTags = relation
    ? relation.context.toArray().map((id) => ["c", id])
    : [];
  const deletePlan = planDelete(plan, relationsID, KIND_KNOWLEDGE_LIST, [
    ...headTag,
    ...contextTags,
  ]);
  const updatedRelations = userDB.relations.remove(shortID(relationsID));
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  const affectedRoot = relation?.root;
  return {
    ...deletePlan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: affectedRoot
      ? deletePlan.affectedRoots.add(affectedRoot)
      : deletePlan.affectedRoots,
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
export function buildDocumentEvents(
  plan: Plan
): List<UnsignedEvent & EventAttachment> {
  const author = plan.user.publicKey;
  const userDB = plan.knowledgeDBs.get(author, newDB());
  return plan.affectedRoots.reduce(
    (events, rootId) => {
      const rootRelation = userDB.relations.find(
        (r) => shortID(r.id) === rootId
      );
      if (!rootRelation) {
        const deleteEvent = {
          kind: KIND_DELETE,
          pubkey: author,
          created_at: newTimestamp(),
          tags: [
            ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${rootId}`],
            ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
            msTag(),
          ],
          content: "",
        };
        return events.push(deleteEvent as UnsignedEvent & EventAttachment);
      }
      if (rootRelation.head === VERSIONS_NODE_ID || rootRelation.context.size > 0) {
        return events;
      }
      const event = buildDocumentEvent(
        plan,
        rootRelation
      );
      return events.push(event as UnsignedEvent & EventAttachment);
    },
    plan.publishEvents
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
    const filteredEvents = buildDocumentEvents(plan);

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
      affectedRoots: ImmutableSet<ID>(),
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
    affectedRoots: ImmutableSet<ID>(),
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

  const pane = getPane(planWithExpanded, parentPath);
  const author = getEffectiveAuthor(planWithExpanded, parentPath);
  const relations = getRelationsForContext(
    planWithExpanded.knowledgeDBs,
    author,
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
