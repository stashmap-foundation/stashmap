/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_CONTACTLIST,
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
import { newDB } from "./knowledge";
import { buildDocumentEvent } from "./markdownDocument";
import { buildDocumentEventFromRelations } from "./relationsDocumentEvent";
import {
  shortID,
  EMPTY_SEMANTIC_ID,
  isEmptySemanticID,
  getNode,
  resolveNode,
  computeEmptyNodeMetadata,
  isSearchId,
  ensureRelationNativeFields,
  getRelationContext,
  getSemanticID,
  getNodeText,
  isRefNode,
} from "./connections";
import type { RefTargetSeed, TextSeed } from "./connections";
import {
  getOwnSystemRoot,
  getSystemRoleText,
  LOG_ROOT_ROLE,
} from "./systemRoots";
import {
  newRelations,
  upsertRelations,
  ViewPath,
  getRowIDFromView,
  updateView,
  getContext,
  getParentView,
  bulkUpdateViewPathsAfterAddRelation,
  copyViewsWithRelationsMapping,
  viewPathToString,
  getRelationForView,
  addNodeToPathWithRelations,
  getPaneIndex,
} from "./ViewContext";
import { newRefNode } from "./relationFactory";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { useRelaysToCreatePlan } from "./relays";
import { mergePublishResultsOfEvents } from "./commons/PublishingStatus";
import { createRootAnchor } from "./rootAnchor";
import {
  MultiSelectionState,
  clearSelection,
  deselectAllChildren,
  shiftSelect,
  toggleSelect,
} from "./selection";
import { withUsersEntryPublicKey, getUsersEntryPublicKey } from "./userEntry";
import { decodePublicKeyInputSync } from "./nostrPublicKeys";

function getAnchorSnapshotLabels(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): string[] {
  const labels: string[] = [];
  let parentRelationID = relation.parent;
  while (parentRelationID) {
    const parentRelation = getNode(
      knowledgeDBs,
      parentRelationID,
      relation.author
    );
    if (!parentRelation) {
      break;
    }
    labels.unshift(
      getNodeText(parentRelation) ||
        shortID(getSemanticID(knowledgeDBs, parentRelation))
    );
    parentRelationID = parentRelation.parent;
  }
  return labels;
}

export function getPane(plan: Plan | Data, viewPath: ViewPath): Pane {
  const paneIndex = viewPath[0];
  return plan.panes[paneIndex];
}

type GraphPlanData = Pick<
  Data,
  | "contacts"
  | "user"
  | "contactsRelays"
  | "knowledgeDBs"
  | "semanticIndex"
  | "relaysInfos"
  | "projectMembers"
>;

export type GraphPlan = GraphPlanData & {
  publishEvents: List<UnsignedEvent & EventAttachment>;
  affectedRoots: ImmutableSet<ID>;
  relays: AllRelays;
};

export type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

export type Plan = WorkspacePlan;

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
        return ["p", c.publicKey, "", c.userName];
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

export function planUpsertContact<T extends GraphPlan>(
  plan: T,
  contact: Contact
): T {
  const existing = plan.contacts.get(contact.publicKey);
  if (
    existing?.publicKey === contact.publicKey &&
    existing?.mainRelay === contact.mainRelay &&
    existing?.userName === contact.userName
  ) {
    return plan;
  }
  const newContacts = plan.contacts.set(contact.publicKey, contact);
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

export function planEnsureSystemRoot<T extends GraphPlan>(
  plan: T,
  systemRole: RootSystemRole
): [T, GraphNode] {
  const existing = getOwnSystemRoot(
    plan.knowledgeDBs,
    plan.user.publicKey,
    systemRole
  );
  if (existing) {
    return [plan, existing];
  }

  const relation = newRelations(
    getSystemRoleText(systemRole),
    List<ID>(),
    plan.user.publicKey,
    undefined,
    undefined,
    systemRole
  );

  return [upsertRelationsCore(plan, relation), relation];
}

export function planUpsertMemberlist<T extends GraphPlan>(
  plan: T,
  members: Members
): T {
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

export function planAddContacts<T extends GraphPlan>(
  plan: T,
  publicKeys: List<PublicKey>
): T {
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

export function planRemoveContact<T extends GraphPlan>(
  plan: T,
  publicKey: PublicKey
): T {
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

function upsertRelationsCore<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const normalizedRelations = ensureRelationNativeFields(
    plan.knowledgeDBs,
    nodes
  );
  const updatedRelations = userDB.nodes.set(
    shortID(normalizedRelations.id),
    normalizedRelations
  );
  const updatedDB = {
    ...userDB,
    nodes: updatedRelations,
  };
  const affectedRoot = normalizedRelations.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: plan.affectedRoots.add(affectedRoot),
  };
}

function addCrefToLog<T extends GraphPlan>(plan: T, relationID: LongID): T {
  const [planWithLog, nodes] = planEnsureSystemRoot(plan, LOG_ROOT_ROLE);
  const crefNode = newRefNode(
    plan.user.publicKey,
    nodes.root as LongID,
    relationID,
    nodes.id as LongID
  );
  const planWithCref = upsertRelationsCore(planWithLog, crefNode);
  return upsertRelationsCore(planWithCref, {
    ...nodes,
    children: nodes.children.insert(0, crefNode.id),
  });
}

export function planUpsertRelations<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const isNewRelation = !userDB.nodes.has(shortID(nodes.id));
  const basePlan = upsertRelationsCore(plan, nodes);

  const isRootRelation = isNewRelation && !nodes.parent;
  const shouldAddToLog = isRootRelation && nodes.systemRole === undefined;
  if (!shouldAddToLog) {
    return basePlan;
  }
  return addCrefToLog(basePlan, nodes.id);
}

export type AddToParentTarget = ID | TextSeed | RefTargetSeed;

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
  const updatedRelation = withUsersEntryPublicKey({
    ...currentRelation,
    text,
    updated: Date.now(),
  });
  const basePlan = planUpsertRelations(plan, updatedRelation);
  const userPublicKey = getUsersEntryPublicKey(text, currentRelation);
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
  relationsID: LongID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(publicKey);
  if (!myDB) {
    return knowledgeDBs;
  }

  const shortRelationsID = relationsID.includes("_")
    ? relationsID.split("_")[1]
    : relationsID;
  const existingRelations = myDB.nodes.get(shortRelationsID);
  if (!existingRelations) {
    return knowledgeDBs;
  }

  const filteredItems = existingRelations.children.filter(
    (itemID) => !isEmptySemanticID(itemID)
  );
  if (filteredItems.size === existingRelations.children.size) {
    return knowledgeDBs;
  }

  const updatedRelations = myDB.nodes.set(shortRelationsID, {
    ...existingRelations,
    children: filteredItems,
  });
  return knowledgeDBs.set(publicKey, {
    ...myDB,
    nodes: updatedRelations,
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

export function planAddTargetsToRelation<T extends GraphPlan>(
  plan: T,
  parentRelation: GraphNode,
  targets: AddToParentTarget | AddToParentTarget[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [T, ID[]] {
  type ChildPayload = {
    childID: ID;
  };

  const targetsArray = Array.isArray(targets) ? targets : [targets];
  if (targetsArray.length === 0) {
    return [plan, []];
  }

  const parentContext = getRelationContext(plan.knowledgeDBs, parentRelation);
  const childContext = parentContext.push(
    getSemanticID(plan.knowledgeDBs, parentRelation)
  );

  const [planWithChildren, relationItemPayload] = targetsArray.reduce<
    [T, ChildPayload[]]
  >(
    ([accPlan, accItems], objectOrID) => {
      const refTarget =
        typeof objectOrID !== "string" && "targetID" in objectOrID
          ? objectOrID
          : undefined;
      const objectID =
        typeof objectOrID === "string"
          ? objectOrID
          : "id" in objectOrID
          ? objectOrID.id
          : objectOrID.targetID;
      const objectText =
        typeof objectOrID !== "string" && "text" in objectOrID
          ? objectOrID.text
          : undefined;
      const localID = shortID(objectID as ID) as ID;
      if (refTarget || isSearchId(localID)) {
        const childNode = refTarget
          ? newRefNode(
              accPlan.user.publicKey,
              parentRelation.root,
              refTarget.targetID,
              parentRelation.id,
              relevance,
              argument,
              undefined,
              refTarget.linkText
            )
          : ({
              children: List<ID>(),
              id: objectID,
              text: "",
              parent: parentRelation.id,
              updated: Date.now(),
              author: accPlan.user.publicKey,
              root: parentRelation.root,
              relevance,
              argument,
            } as GraphNode);
        const planWithChild = planUpsertRelations(accPlan, childNode);
        return [
          planWithChild,
          [
            ...accItems,
            {
              childID: childNode.id,
            },
          ],
        ];
      }

      const existingRelation = getNode(
        accPlan.knowledgeDBs,
        objectID,
        accPlan.user.publicKey
      );
      if (existingRelation && existingRelation.id === objectID) {
        const updatedChild = {
          ...existingRelation,
          parent: parentRelation.id,
          root: parentRelation.root,
          relevance:
            relevance !== undefined ? relevance : existingRelation.relevance,
          argument:
            argument !== undefined ? argument : existingRelation.argument,
        };
        return [
          planUpsertRelations(accPlan, updatedChild),
          [
            ...accItems,
            {
              childID: updatedChild.id,
            },
          ],
        ];
      }

      const childRelation = newRelations(
        objectText || "",
        childContext,
        accPlan.user.publicKey,
        parentRelation.root,
        parentRelation.id
      );
      const relationWithUserPublicKey = objectText
        ? withUsersEntryPublicKey(childRelation, objectText)
        : childRelation;
      const relationWithMetadata = {
        ...relationWithUserPublicKey,
        relevance,
        argument,
      };
      return [
        planUpsertRelations(accPlan, relationWithMetadata),
        [
          ...accItems,
          {
            childID: relationWithMetadata.id,
          },
        ],
      ];
    },
    [plan, []]
  );

  const insertedRelation = relationItemPayload.reduce<GraphNode>(
    (acc, item, currentIndex) => {
      const ord =
        insertAtIndex !== undefined ? insertAtIndex + currentIndex : undefined;
      const defaultOrder = acc.children.size;
      const withPush = {
        ...acc,
        children: acc.children.push(item.childID),
      };
      return ord !== undefined && ord !== defaultOrder
        ? {
            ...withPush,
            children: withPush.children
              .filter((_, index) => index !== defaultOrder)
              .splice(ord, 0, item.childID),
          }
        : withPush;
    },
    parentRelation
  );

  return [
    planUpsertRelations(planWithChildren, insertedRelation),
    relationItemPayload.map((item) => item.childID),
  ];
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
  const ensureParentRelation = (): [Plan, GraphNode] => {
    const [, parentView] = getRowIDFromView(plan, parentViewPath);
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
      (nodes) => nodes
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
  const [updatedRelationsPlan, actualItemIDs] = planAddTargetsToRelation(
    planWithParent,
    parentRelation,
    targets,
    insertAtIndex,
    relevance,
    argument
  );
  const updatedViews =
    bulkUpdateViewPathsAfterAddRelation(updatedRelationsPlan);

  return [planUpdateViews(updatedRelationsPlan, updatedViews), actualItemIDs];
}

type RelationsIdMapping = Map<LongID, LongID>;

function getEffectiveParentRelationID(relation: GraphNode): LongID | undefined {
  return relation.parent;
}

function getRelationDepth(
  relationsByID: Map<ID, GraphNode>,
  relation: GraphNode
): number {
  let depth = 0;
  let currentRelation: GraphNode | undefined = relation;
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
  plan: GraphPlan,
  sourceRelation: GraphNode,
  filterRelation: (relation: GraphNode) => boolean = () => true
): List<GraphNode> {
  const authorRelations =
    plan.knowledgeDBs.get(sourceRelation.author)?.nodes.valueSeq().toList() ||
    List<GraphNode>();
  const authorRelationsByID = authorRelations.reduce(
    (acc, relation) => acc.set(shortID(relation.id), relation),
    Map<ID, GraphNode>()
  );
  const childrenByParent = authorRelations
    .filter((relation) => relation.root === sourceRelation.root)
    .reduce((acc, relation) => {
      const parentID = getEffectiveParentRelationID(relation);
      if (!parentID) {
        return acc;
      }
      return acc.update(parentID, List<GraphNode>(), (nodes) =>
        nodes.push(relation)
      );
    }, Map<LongID, List<GraphNode>>());

  const ordered: GraphNode[] = [];
  const queue: GraphNode[] = filterRelation(sourceRelation)
    ? [sourceRelation]
    : [];
  const seen = new Set<LongID>(queue.map((relation) => relation.id));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    ordered.push(current);
    const children = childrenByParent
      .get(current.id, List<GraphNode>())
      .sortBy((relation) => getRelationDepth(authorRelationsByID, relation));
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

export function planCopyDescendantRelations<T extends GraphPlan>(
  plan: T,
  sourceRelation: GraphNode,
  getSemanticContext: (relation: GraphNode) => Context,
  filterRelation?: (relation: GraphNode) => boolean,
  targetParentRelationID?: LongID,
  targetSemanticID?: ID,
  root?: ID
): [T, RelationsIdMapping] {
  const descendants = getRelationSubtree(
    plan,
    sourceRelation,
    filterRelation ?? (() => true)
  );

  const { copiedRelations } = descendants.reduce(
    (acc, relation) => {
      const newSemanticContext = getSemanticContext(relation);
      const isRootRelation = relation.id === sourceRelation.id;
      const baseRelation = newRelations(
        isRootRelation && typeof targetSemanticID === "string"
          ? targetSemanticID
          : relation.text,
        newSemanticContext,
        plan.user.publicKey,
        acc.copiedRoot
      );
      const nextCopiedRoot = acc.copiedRoot ?? baseRelation.root;
      return {
        copiedRoot: nextCopiedRoot,
        copiedRelations: acc.copiedRelations.push({
          source: relation,
          newSemanticContext,
          sourceParentID: getEffectiveParentRelationID(relation),
          copy: baseRelation,
        }),
      };
    },
    {
      copiedRoot: root,
      copiedRelations: List<{
        source: GraphNode;
        newSemanticContext: Context;
        sourceParentID?: LongID;
        copy: GraphNode;
      }>(),
    }
  );

  const resultMapping = copiedRelations.reduce(
    (acc, { source, copy }) => acc.set(source.id, copy.id),
    Map<LongID, LongID>()
  );

  const resultPlan = copiedRelations.reduce(
    (accPlan, { source, newSemanticContext, sourceParentID, copy }) => {
      const isRootRelation = source.id === sourceRelation.id;
      const children = source.children.map((childID) => {
        const mappedID = resultMapping.get(childID as LongID);
        return mappedID || childID;
      });
      const copiedParentID = isRootRelation
        ? targetParentRelationID
        : sourceParentID
        ? resultMapping.get(sourceParentID)
        : undefined;
      return upsertRelationsCore(accPlan, {
        ...copy,
        children,
        parent: copiedParentID,
        anchor: (() => {
          if (!isRootRelation || targetParentRelationID) {
            return undefined;
          }
          return createRootAnchor(
            newSemanticContext,
            source,
            getAnchorSnapshotLabels(accPlan.knowledgeDBs, source)
          );
        })(),
        text: source.text,
        basedOn: source.id,
      });
    },
    plan
  );

  return [resultPlan as T, resultMapping];
}

export function planMoveDescendantRelations<T extends GraphPlan>(
  plan: T,
  sourceRelation: GraphNode,
  targetSemanticContext: Context,
  targetParentRelationID?: LongID,
  targetSemanticID?: ID,
  root?: ID
): T {
  const descendants = getRelationSubtree(plan, sourceRelation);
  const sourceSemanticID = getSemanticID(plan.knowledgeDBs, sourceRelation);
  const sourceSemanticContext = getRelationContext(
    plan.knowledgeDBs,
    sourceRelation
  );
  const effectiveTargetSemanticID = targetSemanticID ?? sourceSemanticID;
  const sourceChildContext = sourceSemanticContext.push(
    shortID(sourceSemanticID)
  );
  const targetChildContext = targetSemanticContext.push(
    shortID(effectiveTargetSemanticID)
  );

  return descendants.reduce((accPlan, relation) => {
    const isRootRelation = relation.id === sourceRelation.id;
    const relationSemanticContext = getRelationContext(
      accPlan.knowledgeDBs,
      relation
    );
    const newSemanticContext = isRootRelation
      ? targetSemanticContext
      : targetChildContext.concat(
          relationSemanticContext.skip(sourceChildContext.size)
        );
    return planUpsertRelations(accPlan, {
      ...relation,
      parent: isRootRelation
        ? targetParentRelationID
        : getEffectiveParentRelationID(relation),
      anchor:
        isRootRelation && !targetParentRelationID
          ? createRootAnchor(newSemanticContext)
          : undefined,
      root: root ?? relation.root,
    });
  }, plan);
}

export function planMoveTreeDescendantsToContext(
  plan: Plan,
  originalTopNodeIDs: ID[],
  sourceRelationIDs: LongID[],
  actualNodeIDs: ID[],
  parentViewPath: ViewPath,
  stack: ID[],
  root?: ID
): Plan {
  const targetParentRelation = getRelationForView(plan, parentViewPath, stack);
  const parentContext = getContext(plan, parentViewPath, stack);
  const [parentItemID] = getRowIDFromView(plan, parentViewPath);
  const targetSemanticContext = parentContext.push(
    targetParentRelation
      ? getSemanticID(plan.knowledgeDBs, targetParentRelation)
      : (shortID(parentItemID as ID) as ID)
  );

  return originalTopNodeIDs.reduce((accPlan, originalID, index) => {
    const actualID = actualNodeIDs[index];
    const sourceRelationID = sourceRelationIDs[index];
    const sourceRelation = sourceRelationID
      ? getNode(accPlan.knowledgeDBs, sourceRelationID, accPlan.user.publicKey)
      : undefined;
    if (!sourceRelation) {
      return accPlan;
    }
    return planMoveDescendantRelations(
      accPlan,
      sourceRelation,
      targetSemanticContext,
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
    ? getNode(
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
    (relation) => getRelationContext(plan.knowledgeDBs, relation),
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
  const [sourceItemID] = getRowIDFromView(plan, sourceViewPath);
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceSemanticContext = getContext(plan, sourceViewPath, sourceStack);
  const sourceRelation = getRelationForView(plan, sourceViewPath, sourceStack);

  const resolveSource = (): {
    itemID: ID;
    semanticContext: Context;
    relation?: GraphNode;
  } => {
    const sourceNode = getNode(
      plan.knowledgeDBs,
      sourceItemID,
      plan.user.publicKey
    );
    if (isRefNode(sourceNode)) {
      const relation = resolveNode(plan.knowledgeDBs, sourceNode);
      if (relation) {
        return {
          itemID: getSemanticID(plan.knowledgeDBs, relation),
          semanticContext: getRelationContext(plan.knowledgeDBs, relation),
          relation,
        };
      }
    }
    return {
      itemID: sourceItemID,
      semanticContext: sourceSemanticContext,
      relation: sourceRelation,
    };
  };

  const resolved = resolveSource();
  const resolvedItemID = resolved.itemID;
  const resolvedSemanticContext = resolved.semanticContext;
  const resolvedRelation = resolved.relation;

  const [planWithParent, targetParentRelation] = (() => {
    const parentRelation = getRelationForView(
      plan,
      targetParentViewPath,
      stack
    );
    if (parentRelation) {
      return [plan, parentRelation] as const;
    }
    const planWithCreatedParent = upsertRelations(
      plan,
      targetParentViewPath,
      stack,
      (nodes) => nodes
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

  const targetParentSemanticContext = getContext(
    planWithParent,
    targetParentViewPath,
    stack
  );
  const [targetParentRowID] = getRowIDFromView(
    planWithParent,
    targetParentViewPath
  );
  const nodeSemanticContext = targetParentSemanticContext.push(
    targetParentRelation
      ? getSemanticID(planWithParent.knowledgeDBs, targetParentRelation)
      : (shortID(targetParentRowID as ID) as ID)
  );
  const sourceChildContext = resolvedSemanticContext.push(
    shortID(resolvedItemID)
  );
  const targetChildContext = nodeSemanticContext.push(shortID(resolvedItemID));

  if (!resolvedRelation) {
    throw new Error(
      "Cannot deep copy a row without a concrete source relation"
    );
  }

  const [planWithCopiedRelations, mapping] = planCopyDescendantRelations(
    planWithParent,
    resolvedRelation,
    (relation) => {
      const isRootRelation = relation.id === resolvedRelation.id;
      const relationSemanticContext = getRelationContext(
        planWithParent.knowledgeDBs,
        relation
      );
      return isRootRelation
        ? nodeSemanticContext
        : targetChildContext.concat(
            relationSemanticContext.skip(sourceChildContext.size)
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

  const nodes = getRelationForView(planWithCopy, targetParentViewPath, stack);
  if (!nodes || nodes.children.size === 0) {
    return planWithCopy;
  }

  const targetIndex = insertAtIndex ?? nodes.children.size - 1;
  const targetViewPath = addNodeToPathWithRelations(
    targetParentViewPath,
    nodes,
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
export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  const node = {
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
  const createdRelation = withUsersEntryPublicKey(
    newRelations(createdNode.text, List<ID>(), plan.user.publicKey),
    createdNode.text
  );
  const planWithRelation = planUpsertRelations(planWithNode, createdRelation);

  const paneIndex = getPaneIndex(viewPath);
  const newPanes = planWithRelation.panes.map((p, i) =>
    i === paneIndex
      ? {
          ...p,
          stack: [
            getSemanticID(planWithRelation.knowledgeDBs, createdRelation),
          ],
          rootRelation: createdRelation.id,
        }
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
  const [itemID] = getRowIDFromView(plan, viewPath);
  const currentRelation = getRelationForView(plan, viewPath, stack);
  const parentPath = getParentView(viewPath);

  if (isEmptySemanticID(itemID)) {
    if (!parentPath) {
      if (!trimmedText) return { plan, viewPath };
      return planCreateNoteAtRoot(plan, trimmedText, viewPath);
    }
    const nodes = getRelationForView(plan, parentPath, stack);

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
      relevance ?? metadata?.relationItem.relevance,
      argument ?? metadata?.relationItem.argument
    );
    return { plan: resultPlan, viewPath };
  }

  const currentItem = getNode(plan.knowledgeDBs, itemID, plan.user.publicKey);
  if ((currentItem && isRefNode(currentItem)) || isSearchId(itemID as ID)) {
    return { plan, viewPath };
  }

  const displayText = currentRelation?.text ?? "";

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

export function planDeleteSemanticID(plan: Plan, semanticID: ID): Plan {
  // Prevent deletion of empty placeholder node
  if (isEmptySemanticID(semanticID)) {
    return plan;
  }
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const ownedStandaloneRoots = userDB.nodes
    .valueSeq()
    .filter(
      (relation) =>
        relation.author === plan.user.publicKey &&
        shortID(getSemanticID(plan.knowledgeDBs, relation)) ===
          shortID(semanticID as ID) &&
        relation.root === shortID(relation.id)
    )
    .sortBy((relation) => -relation.updated)
    .toList();

  return ownedStandaloneRoots.reduce((accPlan, relation) => {
    const withDescendants = planDeleteDescendantRelations(accPlan, relation);
    return planDeleteRelations(withDescendants, relation.id);
  }, plan);
}

export function planDeleteRelations<T extends GraphPlan>(
  plan: T,
  relationsID: LongID
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const relation = userDB.nodes.get(shortID(relationsID));
  const updatedRelations = userDB.nodes.remove(shortID(relationsID));
  const updatedDB = {
    ...userDB,
    nodes: updatedRelations,
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

export function planDeleteDescendantRelations<T extends GraphPlan>(
  plan: T,
  sourceRelation: GraphNode
): T {
  const userRelationsByID = plan.knowledgeDBs.get(
    plan.user.publicKey,
    newDB()
  ).nodes;
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
// so any nodes modification will include them - we need to filter before publishing
export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  const author = plan.user.publicKey;
  const userDB = plan.knowledgeDBs.get(author, newDB());
  return plan.affectedRoots.reduce((events, rootId) => {
    const rootRelation = userDB.nodes.find(
      (r) =>
        !r.parent &&
        (r.id === rootId ||
          shortID(r.id) === rootId ||
          r.root === rootId ||
          r.root === shortID(rootId as ID))
    );
    if (!rootRelation) {
      const rootDTag = shortID(rootId as ID);
      const deleteEvent = {
        kind: KIND_DELETE,
        pubkey: author,
        created_at: newTimestamp(),
        tags: [
          ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${rootDTag}`],
          ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
          msTag(),
        ],
        content: "",
      };
      return events.push(deleteEvent as UnsignedEvent & EventAttachment);
    }
    const workspacePlan = plan as Partial<WorkspacePlan>;
    const event =
      workspacePlan.views !== undefined && workspacePlan.panes !== undefined
        ? buildDocumentEvent(workspacePlan as Data, rootRelation)
        : buildDocumentEventFromRelations(plan.knowledgeDBs, rootRelation);
    return events.push(event as UnsignedEvent & EventAttachment);
  }, plan.publishEvents);
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
  setPanes,
  setViews,
  db,
  getRelays,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
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
    setViews(plan.views);
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

type CreateGraphPlanProps = GraphPlanData & {
  publishEvents?: List<UnsignedEvent & EventAttachment>;
  relays: AllRelays;
};

export function createGraphPlan(props: CreateGraphPlanProps): GraphPlan {
  return {
    ...props,
    publishEvents:
      props.publishEvents || List<UnsignedEvent & EventAttachment>([]),
    affectedRoots: ImmutableSet<ID>(),
  };
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
  const planWithOwnRelations = upsertRelations(
    plan,
    parentPath,
    stack,
    (r) => r
  );

  // 2. Use planExpandNode for consistent expansion handling
  const [, parentView] = getRowIDFromView(planWithOwnRelations, parentPath);
  const planWithExpanded = planExpandNode(
    planWithOwnRelations,
    parentView,
    parentPath
  );

  const nodes = getRelationForView(planWithExpanded, parentPath, stack);
  if (!nodes) {
    return plan;
  }

  // 4. Add temporary event to show empty node at position
  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      relationsID: nodes.id,
      index: insertIndex,
      relationItem: {
        children: List<ID>(),
        id: EMPTY_SEMANTIC_ID,
        text: "",
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

  const updatedRelationItem: GraphNode = {
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
