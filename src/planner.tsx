import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
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
import { buildDocumentEvent } from "./markdownDocument";
import {
  shortID,
  newNode,
  isTextNode,
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
  isSearchId,
  hashText,
  getTextForMatching,
  ensureRelationNativeFields,
} from "./connections";
import {
  newRelations,
  newRelationsForNode,
  upsertRelations,
  ViewPath,
  getNodeIDFromView,
  updateView,
  getContext,
  getParentView,
  bulkUpdateViewPathsAfterAddRelation,
  copyViewsWithRelationsMapping,
  viewPathToString,
  getRelationForView,
  getAlternativeRelations,
  addNodeToPathWithRelations,
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

function upsertRelationsCore(plan: Plan, relations: Relations): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const normalizedRelations = ensureRelationNativeFields(
    plan.knowledgeDBs,
    relations
  );
  const updatedRelations = userDB.relations.set(
    shortID(normalizedRelations.id),
    normalizedRelations
  );
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  const affectedRoot = normalizedRelations.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: plan.affectedRoots.add(affectedRoot),
  };
}

function addCrefToLog(plan: Plan, relationID: LongID): Plan {
  const logRelations = getAlternativeRelations(
    plan.knowledgeDBs,
    LOG_NODE_ID,
    List<ID>(),
    undefined,
    plan.user.publicKey
  )
    .filter(
      (candidate) =>
        candidate.author === plan.user.publicKey &&
        candidate.root === shortID(candidate.id)
    )
    .sort((a, b) => b.updated - a.updated)
    .first();
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
  return upsertRelationsCore(plan, updatedRelations);
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

type AddToParentTarget = LongID | ID | KnowNode;

export function planUpdateRelationText(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  text: string
): Plan {
  const currentRelation = getRelationForView(plan, viewPath, stack);
  if (!currentRelation || currentRelation.author !== plan.user.publicKey) {
    return plan;
  }
  if (currentRelation.text === text) {
    return plan;
  }
  return planUpsertRelations(plan, {
    ...currentRelation,
    text,
    textHash: hashText(text),
    updated: Date.now(),
  });
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
    (item) => !isEmptyNodeID(item.id)
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

export function planAddToParent(
  plan: Plan,
  nodeIDs: AddToParentTarget | AddToParentTarget[],
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

  const ensureParentRelation = (): [Plan, Relations] => {
    const [, parentView] = getNodeIDFromView(plan, parentViewPath);
    const planWithExpand = planExpandNode(plan, parentView, parentViewPath);
    const existingRelation = getRelationForView(
      planWithExpand,
      parentViewPath,
      stack
    );
    if (existingRelation) {
      return [planWithExpand, existingRelation];
    }
    const planWithParentRelation = upsertRelations(
      planWithExpand,
      parentViewPath,
      stack,
      (relations) => relations
    );
    const parentRelation = getRelationForView(
      planWithParentRelation,
      parentViewPath,
      stack
    );
    if (!parentRelation) {
      throw new Error("Failed to create parent relation");
    }
    return [planWithParentRelation, parentRelation];
  };

  const [planWithParent, parentRelation] = ensureParentRelation();
  const parentContext = getContext(planWithParent, parentViewPath, stack);
  const childContext = parentContext.push(
    shortID(parentRelation.head as ID) as ID
  );

  const [planWithChildren, relationItemPayload] = nodeIDsArray.reduce(
    ([accPlan, accItems], objectOrID) => {
      const objectID =
        typeof objectOrID === "string" ? objectOrID : objectOrID.id;
      const objectText =
        typeof objectOrID === "string"
          ? undefined
          : isTextNode(objectOrID)
          ? objectOrID.text
          : undefined;
      const localID = shortID(objectID as ID) as ID;
      if (isConcreteRefId(objectID) || isSearchId(localID)) {
        return [
          accPlan,
          [...accItems, { relationItemID: objectID, actualNodeID: objectID }],
        ];
      }

      const existingRelation = getRelationsNoReferencedBy(
        accPlan.knowledgeDBs,
        objectID,
        accPlan.user.publicKey
      );
      if (existingRelation && existingRelation.id === objectID) {
        return [
          accPlan,
          [
            ...accItems,
            {
              relationItemID: existingRelation.id,
              actualNodeID: existingRelation.head as ID,
            },
          ],
        ];
      }

      const childRelation = newRelationsForNode(
        objectID,
        childContext,
        accPlan.user.publicKey,
        parentRelation.root,
        parentRelation.id,
        objectText
      );
      return [
        planUpsertRelations(accPlan, childRelation),
        [
          ...accItems,
          {
            relationItemID: childRelation.id,
            actualNodeID: childRelation.head as ID,
          },
        ],
      ];
    },
    [planWithParent, [] as Array<{ relationItemID: LongID | ID; actualNodeID: LongID | ID }>]
  );

  const updatedRelationsPlan = upsertRelations(
    planWithChildren,
    parentViewPath,
    stack,
    (relations) =>
      bulkAddRelations(
        relations,
        relationItemPayload.map((item) => item.relationItemID),
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

  return [
    planUpdateViews(updatedRelationsPlan, updatedViews),
    relationItemPayload.map((item) => item.actualNodeID),
  ];
}

type RelationsIdMapping = Map<LongID, LongID>;

function getEffectiveParentRelationID(relation: Relations): LongID | undefined {
  return relation.parent;
}

function getRelationDepth(
  relationsByID: Map<ID, Relations>,
  relation: Relations
): number {
  let depth = 0;
  let currentRelation: Relations | undefined = relation;
  const seen = new Set<ID>();

  while (currentRelation?.parent) {
    const parentID = shortID(currentRelation.parent) as ID;
    if (seen.has(parentID)) {
      break;
    }
    seen.add(parentID);
    currentRelation = relationsByID.get(parentID);
    if (!currentRelation) {
      break;
    }
    depth += 1;
  }

  return depth;
}

function getRelationSubtree(
  plan: Plan,
  sourceRelation: Relations,
  filterRelation: (relation: Relations) => boolean = () => true
): List<Relations> {
  const authorRelations =
    plan.knowledgeDBs.get(sourceRelation.author)?.relations.valueSeq().toList() ||
    List<Relations>();
  const authorRelationsByID = authorRelations.reduce(
    (acc, relation) => acc.set(shortID(relation.id), relation),
    Map<ID, Relations>()
  );
  const childrenByParent = authorRelations
    .filter((relation) => relation.root === sourceRelation.root)
    .reduce(
      (acc, relation) => {
        const parentID = getEffectiveParentRelationID(relation);
        if (!parentID) {
          return acc;
        }
        return acc.update(parentID, List<Relations>(), (relations) =>
          relations.push(relation)
        );
      },
      Map<LongID, List<Relations>>()
    );

  const ordered: Relations[] = [];
  const queue: Relations[] = filterRelation(sourceRelation) ? [sourceRelation] : [];
  const seen = new Set<LongID>(queue.map((relation) => relation.id));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    ordered.push(current);
    const children = childrenByParent.get(current.id, List<Relations>()).sortBy(
      (relation) => getRelationDepth(authorRelationsByID, relation)
    );
    children.forEach((child) => {
      if (seen.has(child.id) || !filterRelation(child)) {
        return;
      }
      seen.add(child.id);
      queue.push(child);
    });
  }

  return List(ordered);
}

function planCopyDescendantRelations(
  plan: Plan,
  sourceRelation: Relations,
  transformContext: (relation: Relations) => Context,
  filterRelation?: (relation: Relations) => boolean,
  targetParentRelationID?: LongID,
  targetNodeID?: LongID | ID,
  root?: ID
): [Plan, RelationsIdMapping] {
  const descendants = getRelationSubtree(
    plan,
    sourceRelation,
    filterRelation ?? (() => true)
  );

  let copiedRoot = root;
  const sourceNodeID = sourceRelation.head as ID;
  const copiedRelations = descendants.map((relation) => {
    const newContext = transformContext(relation);
    const isRootRelation = relation.id === sourceRelation.id;
    const head =
      targetNodeID && isRootRelation
        ? targetNodeID
        : relation.head;
    const baseRelation = newRelations(
      head,
      newContext,
      plan.user.publicKey,
      copiedRoot
    );
    copiedRoot = copiedRoot ?? baseRelation.root;
    return {
      source: relation,
      sourceParentID: getEffectiveParentRelationID(relation),
      copy: baseRelation,
    };
  });

  const resultMapping = copiedRelations.reduce(
    (acc, { source, copy }) => acc.set(source.id, copy.id),
    Map<LongID, LongID>()
  );

  const resultPlan = copiedRelations.reduce(
    (accPlan, { source, sourceParentID, copy }) => {
      const isRootRelation = source.id === sourceRelation.id;
      const items = source.items.map((item) => {
        const mappedID = resultMapping.get(item.id as LongID);
        return mappedID ? { ...item, id: mappedID } : item;
      });
      return planUpsertRelations(accPlan, {
        ...copy,
        items,
        parent: isRootRelation
          ? targetParentRelationID
          : sourceParentID
            ? resultMapping.get(sourceParentID)
            : undefined,
        text: source.text,
        textHash: source.textHash,
        basedOn: source.id,
      });
    },
    plan
  );

  return [resultPlan, resultMapping];
}

export function planMoveDescendantRelations(
  plan: Plan,
  sourceRelation: Relations,
  targetContext: Context,
  targetParentRelationID?: LongID,
  targetNodeID?: LongID | ID,
  root?: ID
): Plan {
  const descendants = getRelationSubtree(plan, sourceRelation);
  const sourceNodeID = sourceRelation.head as ID;
  const sourceContext = sourceRelation.context;
  const effectiveTargetNodeID = targetNodeID ?? sourceNodeID;
  const sourceChildContext = sourceContext.push(shortID(sourceNodeID));
  const targetChildContext = targetContext.push(shortID(effectiveTargetNodeID));

  return descendants.reduce((accPlan, relation) => {
    const isRootRelation = relation.id === sourceRelation.id;
    const newContext = isRootRelation
      ? targetContext
      : targetChildContext.concat(
          relation.context.skip(sourceChildContext.size)
        );
    const head = isRootRelation
      ? shortID(effectiveTargetNodeID)
      : relation.head;
    return planUpsertRelations(accPlan, {
      ...relation,
      head,
      context: newContext,
      parent: isRootRelation
        ? targetParentRelationID
        : getEffectiveParentRelationID(relation),
      root: root ?? relation.root,
    });
  }, plan);
}

export function planMoveTreeDescendantsToContext(
  plan: Plan,
  originalTopNodeIDs: ID[],
  sourceRelationIDs: LongID[],
  actualNodeIDs: (LongID | ID)[],
  parentViewPath: ViewPath,
  stack: ID[],
  root?: ID
): Plan {
  const targetParentRelation = getRelationForView(plan, parentViewPath, stack);
  const parentContext = getContext(plan, parentViewPath, stack);
  const [parentNodeID] = getNodeIDFromView(plan, parentViewPath);
  const targetContext = parentContext.push(
    shortID((targetParentRelation?.head as ID | undefined) ?? parentNodeID)
  );

  return originalTopNodeIDs.reduce((accPlan, originalID, index) => {
    const actualID = actualNodeIDs[index];
    const sourceRelationID = sourceRelationIDs[index];
    const sourceRelation = sourceRelationID
      ? getRelationsNoReferencedBy(
          accPlan.knowledgeDBs,
          sourceRelationID,
          accPlan.user.publicKey
        )
      : undefined;
    if (!sourceRelation) {
      return accPlan;
    }
    return planMoveDescendantRelations(
      accPlan,
      sourceRelation,
      targetContext,
      targetParentRelation?.id,
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

  const sourceRelation =
    rootRelationData || getRelationForView(plan, viewPath, stack);
  if (!sourceRelation) {
    return plan;
  }
  const [planWithRelations, relationsIdMapping] = planCopyDescendantRelations(
    plan,
    sourceRelation,
    (relation) => relation.context,
    (relation) => relation.author === pane.author
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

  const resolveSource = (): {
    nodeID: LongID | ID;
    context: Context;
    relation?: Relations;
  } => {
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
            relation,
          };
        }
      }
    }
    return { nodeID: sourceNodeID, context: sourceContext, relation: sourceRelation };
  };

  const resolved = resolveSource();
  const resolvedNodeID = resolved.nodeID;
  const resolvedContext = resolved.context;
  const resolvedRelation = resolved.relation;

  const [planWithParent, targetParentRelation] = (() => {
    const parentRelation = getRelationForView(plan, targetParentViewPath, stack);
    if (parentRelation) {
      return [plan, parentRelation] as const;
    }
    const planWithCreatedParent = upsertRelations(
      plan,
      targetParentViewPath,
      stack,
      (relations) => relations
    );
    const createdParent = getRelationForView(
      planWithCreatedParent,
      targetParentViewPath,
      stack
    );
    if (!createdParent) {
      throw new Error("Failed to create target parent relation");
    }
    return [planWithCreatedParent, createdParent] as const;
  })();

  const targetParentContext = getContext(
    planWithParent,
    targetParentViewPath,
    stack
  );
  const [targetParentNodeID] = getNodeIDFromView(
    planWithParent,
    targetParentViewPath
  );
  const nodeNewContext = targetParentContext.push(
    shortID((targetParentRelation.head as ID | undefined) ?? targetParentNodeID)
  );
  const sourceChildContext = resolvedContext.push(shortID(resolvedNodeID));
  const targetChildContext = nodeNewContext.push(shortID(resolvedNodeID));

  if (!resolvedRelation) {
    const sourceAuthor = getEffectiveAuthor(plan, sourceViewPath);
    const text = getTextForMatching(
      plan.knowledgeDBs,
      resolvedNodeID,
      sourceAuthor
    );
    const targetToAdd =
      text !== undefined
        ? ({
            id: resolvedNodeID as ID,
            text,
            textHash: hashText(text),
            type: "text",
          } as TextNode)
        : resolvedNodeID;
    const [planWithNode] = planAddToParent(
      planWithParent,
      targetToAdd,
      targetParentViewPath,
      stack,
      insertAtIndex,
      relevance,
      argument
    );
    return [planWithNode, Map<LongID, LongID>()];
  }

  const [planWithCopiedRelations, mapping] = planCopyDescendantRelations(
    planWithParent,
    resolvedRelation,
    (relation) => {
      const isRootRelation = relation.id === resolvedRelation.id;
      return isRootRelation
        ? nodeNewContext
        : targetChildContext.concat(
            relation.context.skip(sourceChildContext.size)
          );
    },
    undefined,
    targetParentRelation.id,
    undefined,
    targetParentRelation.root
  );

  const copiedTopRelationID = mapping.get(resolvedRelation.id);
  if (!copiedTopRelationID) {
    return [planWithCopiedRelations, mapping];
  }

  const [finalPlan] = planAddToParent(
    planWithCopiedRelations,
    copiedTopRelationID,
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
 * Create a new node value for insertion into the current relation tree.
 */
export function planCreateNode(plan: Plan, text: string): [Plan, KnowNode] {
  const node = newNode(text);
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
  const createdRelation = newRelations(
    createdNode.id,
    List<ID>(),
    plan.user.publicKey,
    undefined,
    undefined,
    createdNode.text
  );
  const planWithRelation = planUpsertRelations(
    planWithNode,
    createdRelation
  );

  const paneIndex = getPaneIndex(viewPath);
  const newPanes = planWithRelation.panes.map((p, i) =>
    i === paneIndex
      ? { ...p, stack: [createdNode.id], rootRelation: createdRelation.id }
      : p
  );

  const resultPlan = planUpdatePanes(planWithRelation, newPanes);
  const newViewPath: ViewPath = [paneIndex, createdRelation.id];

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
  const currentRelation = getRelationForView(plan, viewPath, stack);
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
      createdNode,
      parentPath,
      stack,
      emptyNodeIndex,
      relevance ?? metadata?.relationItem.relevance,
      argument ?? metadata?.relationItem.argument
    );
    return { plan: resultPlan, viewPath };
  }

  if (isRefId(nodeID) || isSearchId(nodeID as ID)) {
    return { plan, viewPath };
  }

  const displayText =
    currentRelation?.text ??
    getTextForMatching(plan.knowledgeDBs, nodeID as ID, plan.user.publicKey) ??
    "";

  if (trimmedText === displayText) return { plan, viewPath };

  return {
    plan: currentRelation
      ? planUpdateRelationText(plan, viewPath, stack, trimmedText)
      : plan,
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

export function planDeleteNode(plan: Plan, nodeID: LongID | ID): Plan {
  // Prevent deletion of empty placeholder node
  if (isEmptyNodeID(nodeID)) {
    return plan;
  }
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const ownedStandaloneRoots = userDB.relations
    .valueSeq()
    .filter(
      (relation) =>
        relation.author === plan.user.publicKey &&
        relation.head === shortID(nodeID as ID) &&
        relation.root === shortID(relation.id)
    )
    .sortBy((relation) => -relation.updated)
    .toList();

  return ownedStandaloneRoots.reduce((accPlan, relation) => {
    const withDescendants = planDeleteDescendantRelations(accPlan, relation);
    return planDeleteRelations(withDescendants, relation.id);
  }, plan);
}

export function planDeleteRelations(plan: Plan, relationsID: LongID): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const relation = userDB.relations.get(shortID(relationsID));
  const updatedRelations = userDB.relations.remove(shortID(relationsID));
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  const affectedRoot = relation?.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: affectedRoot
      ? plan.affectedRoots.add(affectedRoot)
      : plan.affectedRoots,
  };
}

export function planDeleteDescendantRelations(
  plan: Plan,
  sourceRelation: Relations
): Plan {
  const userRelationsByID = plan.knowledgeDBs.get(plan.user.publicKey, newDB()).relations;
  const descendants = getRelationSubtree(plan, sourceRelation)
    .filter((relation) => relation.id !== sourceRelation.id)
    .filter((relation) => relation.author === plan.user.publicKey)
    .sortBy((relation) => -getRelationDepth(userRelationsByID, relation));

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
  return plan.affectedRoots.reduce((events, rootId) => {
    const rootRelation = userDB.relations.find((r) => shortID(r.id) === rootId);
    const isStandaloneRootRelation =
      !!rootRelation && rootRelation.root === shortID(rootRelation.id);

    if (!rootRelation || !isStandaloneRootRelation) {
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
    const event = buildDocumentEvent(plan, rootRelation);
    return events.push(event as UnsignedEvent & EventAttachment);
  }, plan.publishEvents);
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
  const [, parentView] = getNodeIDFromView(planWithOwnRelations, parentPath);
  const planWithExpanded = planExpandNode(
    planWithOwnRelations,
    parentView,
    parentPath
  );

  const relations = getRelationForView(planWithExpanded, parentPath, stack);
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
      relationItem: { id: EMPTY_NODE_ID, relevance: undefined },
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
