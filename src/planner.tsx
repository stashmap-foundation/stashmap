/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_CONTACTLIST,
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
import {
  buildDocumentEventFromNodes,
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
  ensureNodeNativeFields,
  getNodeContext,
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
import { newRefNode } from "./nodeFactory";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { useRelaysToCreatePlan } from "./relays";
import { mergePublishResultsOfEvents } from "./commons/PublishingStatus";
import { createRootAnchor } from "./rootAnchor";
import {
  MultiSelectionState,
  clearSelection,
  shiftSelect,
  toggleSelect,
} from "./selection";
import { withUsersEntryPublicKey, getNodeUserPublicKey } from "./userEntry";
import { decodePublicKeyInputSync } from "./nostrPublicKeys";

function getAnchorSnapshotLabels(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string[] {
  const labels: string[] = [];
  let parentNodeID = node.parent;
  while (parentNodeID) {
    const parentNode = getNode(knowledgeDBs, parentNodeID, node.author);
    if (!parentNode) {
      break;
    }
    labels.unshift(
      getNodeText(parentNode) ||
        shortID(getSemanticID(knowledgeDBs, parentNode))
    );
    parentNodeID = parentNode.parent;
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

type WorkspacePlan = GraphPlan &
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

function planEnsureSystemRoot<T extends GraphPlan>(
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

  const node = newNode(
    getSystemRoleText(systemRole),
    List<ID>(),
    plan.user.publicKey,
    undefined,
    undefined,
    systemRole
  );

  return [upsertNodesCore(plan, node), node];
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

function upsertNodesCore<T extends GraphPlan>(plan: T, nodes: GraphNode): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const normalizedNodes = ensureNodeNativeFields(plan.knowledgeDBs, nodes);
  const updatedNodes = userDB.nodes.set(
    shortID(normalizedNodes.id),
    normalizedNodes
  );
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const affectedRoot = normalizedNodes.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: plan.affectedRoots.add(affectedRoot),
  };
}

function addCrefToLog<T extends GraphPlan>(plan: T, nodeID: LongID): T {
  const [planWithLog, nodes] = planEnsureSystemRoot(plan, LOG_ROOT_ROLE);
  const crefNode = newRefNode(
    plan.user.publicKey,
    nodes.root as LongID,
    nodeID,
    nodes.id as LongID
  );
  const planWithCref = upsertNodesCore(planWithLog, crefNode);
  return upsertNodesCore(planWithCref, {
    ...nodes,
    children: nodes.children.insert(0, crefNode.id),
  });
}

export function planUpsertNodes<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const isNewNode = !userDB.nodes.has(shortID(nodes.id));
  const basePlan = upsertNodesCore(plan, nodes);

  const isRootNode = isNewNode && !nodes.parent;
  const shouldAddToLog = isRootNode && nodes.systemRole === undefined;
  if (!shouldAddToLog) {
    return basePlan;
  }
  return addCrefToLog(basePlan, nodes.id);
}

export type AddToParentTarget = ID | TextSeed | RefTargetSeed;

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
  if (currentNode.text === text) {
    return plan;
  }
  const updatedNode = withUsersEntryPublicKey({
    ...currentNode,
    text,
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

export function planAddTargetsToNode<T extends GraphPlan>(
  plan: T,
  parentNode: GraphNode,
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

  const parentContext = getNodeContext(plan.knowledgeDBs, parentNode);
  const childContext = parentContext.push(
    getSemanticID(plan.knowledgeDBs, parentNode)
  );

  const [planWithChildren, nodeItemPayload] = targetsArray.reduce<
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
              parentNode.root,
              refTarget.targetID,
              parentNode.id,
              relevance,
              argument,
              undefined,
              refTarget.linkText
            )
          : ({
              children: List<ID>(),
              id: objectID,
              text: "",
              parent: parentNode.id,
              updated: Date.now(),
              author: accPlan.user.publicKey,
              root: parentNode.root,
              relevance,
              argument,
            } as GraphNode);
        const planWithChild = planUpsertNodes(accPlan, childNode);
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

      const existingNode = getNode(
        accPlan.knowledgeDBs,
        objectID,
        accPlan.user.publicKey
      );
      if (existingNode && existingNode.id === objectID) {
        const updatedChild = {
          ...existingNode,
          parent: parentNode.id,
          root: parentNode.root,
          relevance:
            relevance !== undefined ? relevance : existingNode.relevance,
          argument: argument !== undefined ? argument : existingNode.argument,
        };
        return [
          planUpsertNodes(accPlan, updatedChild),
          [
            ...accItems,
            {
              childID: updatedChild.id,
            },
          ],
        ];
      }

      const childNode = newNode(
        objectText || "",
        childContext,
        accPlan.user.publicKey,
        parentNode.root,
        parentNode.id
      );
      const nodeWithUserPublicKey = objectText
        ? withUsersEntryPublicKey(childNode, objectText)
        : childNode;
      const nodeWithMetadata = {
        ...nodeWithUserPublicKey,
        relevance,
        argument,
      };
      return [
        planUpsertNodes(accPlan, nodeWithMetadata),
        [
          ...accItems,
          {
            childID: nodeWithMetadata.id,
          },
        ],
      ];
    },
    [plan, []]
  );

  const insertedNode = nodeItemPayload.reduce<GraphNode>(
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
    parentNode
  );

  return [
    planUpsertNodes(planWithChildren, insertedNode),
    nodeItemPayload.map((item) => item.childID),
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

function getEffectiveParentNodeID(node: GraphNode): LongID | undefined {
  return node.parent;
}

function getNodeDepth(nodesByID: Map<ID, GraphNode>, node: GraphNode): number {
  let depth = 0;
  let currentNode: GraphNode | undefined = node;
  const seen = new Set<ID>();

  while (currentNode?.parent) {
    const parentID = shortID(currentNode.parent) as ID;
    if (seen.has(parentID)) {
      break;
    }
    seen.add(parentID);
    currentNode = nodesByID.get(parentID);
    if (!currentNode) {
      break;
    }
    depth += 1;
  }

  return depth;
}

function getNodeSubtree(
  plan: GraphPlan,
  sourceNode: GraphNode,
  filterNode: (node: GraphNode) => boolean = () => true
): List<GraphNode> {
  const authorNodes =
    plan.knowledgeDBs.get(sourceNode.author)?.nodes.valueSeq().toList() ||
    List<GraphNode>();
  const authorNodesByID = authorNodes.reduce(
    (acc, node) => acc.set(shortID(node.id), node),
    Map<ID, GraphNode>()
  );
  const childrenByParent = authorNodes
    .filter((node) => node.root === sourceNode.root)
    .reduce((acc, node) => {
      const parentID = getEffectiveParentNodeID(node);
      if (!parentID) {
        return acc;
      }
      return acc.update(parentID, List<GraphNode>(), (nodes) =>
        nodes.push(node)
      );
    }, Map<LongID, List<GraphNode>>());

  const ordered: GraphNode[] = [];
  const queue: GraphNode[] = filterNode(sourceNode) ? [sourceNode] : [];
  const seen = new Set<LongID>(queue.map((node) => node.id));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    ordered.push(current);
    const children = childrenByParent
      .get(current.id, List<GraphNode>())
      .sortBy((node) => getNodeDepth(authorNodesByID, node));
    children.forEach((child) => {
      if (seen.has(child.id) || !filterNode(child)) {
        return;
      }
      seen.add(child.id);
      queue.push(child);
    });
  }

  return List(ordered);
}

function planCopyDescendantNodes<T extends GraphPlan>(
  plan: T,
  sourceNode: GraphNode,
  getSemanticContext: (node: GraphNode) => Context,
  filterNode?: (node: GraphNode) => boolean,
  targetParentNodeID?: LongID,
  targetSemanticID?: ID,
  root?: ID
): [T, NodesIdMapping] {
  const descendants = getNodeSubtree(
    plan,
    sourceNode,
    filterNode ?? (() => true)
  );

  const { copiedNodes } = descendants.reduce(
    (acc, node) => {
      const newSemanticContext = getSemanticContext(node);
      const isRootNode = node.id === sourceNode.id;
      const baseNode = newNode(
        isRootNode && typeof targetSemanticID === "string"
          ? targetSemanticID
          : node.text,
        newSemanticContext,
        plan.user.publicKey,
        acc.copiedRoot
      );
      const nextCopiedRoot = acc.copiedRoot ?? baseNode.root;
      return {
        copiedRoot: nextCopiedRoot,
        copiedNodes: acc.copiedNodes.push({
          source: node,
          newSemanticContext,
          sourceParentID: getEffectiveParentNodeID(node),
          copy: baseNode,
        }),
      };
    },
    {
      copiedRoot: root,
      copiedNodes: List<{
        source: GraphNode;
        newSemanticContext: Context;
        sourceParentID?: LongID;
        copy: GraphNode;
      }>(),
    }
  );

  const resultMapping = copiedNodes.reduce(
    (acc, { source, copy }) => acc.set(source.id, copy.id),
    Map<LongID, LongID>()
  );

  const resultPlan = copiedNodes.reduce(
    (accPlan, { source, newSemanticContext, sourceParentID, copy }) => {
      const isRootNode = source.id === sourceNode.id;
      const children = source.children.map((childID) => {
        const mappedID = resultMapping.get(childID as LongID);
        return mappedID || childID;
      });
      const copiedParentID = isRootNode
        ? targetParentNodeID
        : sourceParentID
        ? resultMapping.get(sourceParentID)
        : undefined;
      return upsertNodesCore(accPlan, {
        ...copy,
        children,
        parent: copiedParentID,
        anchor: (() => {
          if (!isRootNode || targetParentNodeID) {
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

export function planMoveDescendantNodes<T extends GraphPlan>(
  plan: T,
  sourceNode: GraphNode,
  targetSemanticContext: Context,
  targetParentNodeID?: LongID,
  targetSemanticID?: ID,
  root?: ID
): T {
  const descendants = getNodeSubtree(plan, sourceNode);
  const sourceSemanticID = getSemanticID(plan.knowledgeDBs, sourceNode);
  const sourceSemanticContext = getNodeContext(plan.knowledgeDBs, sourceNode);
  const effectiveTargetSemanticID = targetSemanticID ?? sourceSemanticID;
  const sourceChildContext = sourceSemanticContext.push(
    shortID(sourceSemanticID)
  );
  const targetChildContext = targetSemanticContext.push(
    shortID(effectiveTargetSemanticID)
  );

  return descendants.reduce((accPlan, node) => {
    const isRootNode = node.id === sourceNode.id;
    const nodeSemanticContext = getNodeContext(accPlan.knowledgeDBs, node);
    const newSemanticContext = isRootNode
      ? targetSemanticContext
      : targetChildContext.concat(
          nodeSemanticContext.skip(sourceChildContext.size)
        );
    return planUpsertNodes(accPlan, {
      ...node,
      parent: isRootNode ? targetParentNodeID : getEffectiveParentNodeID(node),
      anchor:
        isRootNode && !targetParentNodeID
          ? createRootAnchor(newSemanticContext)
          : undefined,
      root: root ?? node.root,
    });
  }, plan);
}

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

  const displayText = currentNode?.text ?? "";

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

export function planDeleteNodes<T extends GraphPlan>(
  plan: T,
  nodeID: LongID
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const node = userDB.nodes.get(shortID(nodeID));
  const updatedNodes = userDB.nodes.remove(shortID(nodeID));
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const affectedRoot = node?.root;
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: affectedRoot
      ? plan.affectedRoots.add(affectedRoot)
      : plan.affectedRoots,
  };
}

export function planDeleteDescendantNodes<T extends GraphPlan>(
  plan: T,
  sourceNode: GraphNode
): T {
  const userNodesByID = plan.knowledgeDBs.get(
    plan.user.publicKey,
    newDB()
  ).nodes;
  const descendants = getNodeSubtree(plan, sourceNode)
    .filter((node) => node.id !== sourceNode.id)
    .filter((node) => node.author === plan.user.publicKey)
    .sortBy((node) => -getNodeDepth(userNodesByID, node));

  return descendants.reduce(
    (accPlan, node) => planDeleteNodes(accPlan, node.id),
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
    const rootNode = userDB.nodes.find(
      (r) =>
        !r.parent &&
        (r.id === rootId ||
          shortID(r.id) === rootId ||
          r.root === rootId ||
          r.root === shortID(rootId as ID))
    );
    if (!rootNode) {
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
    const snapshotSourceRoot =
      rootNode.basedOn && !rootNode.snapshotDTag
        ? getNode(plan.knowledgeDBs, rootNode.basedOn, author)
        : undefined;
    const createdSnapshotDTag = snapshotSourceRoot
      ? `snapshot-${shortID(rootNode.id as ID)}`
      : undefined;
    const snapshotEvent = snapshotSourceRoot
      ? (buildSnapshotEventFromNodes(
          plan.knowledgeDBs,
          author,
          createdSnapshotDTag as string,
          snapshotSourceRoot
        ) as UnsignedEvent & EventAttachment)
      : undefined;
    const workspacePlan = plan as Partial<WorkspacePlan>;
    const event =
      workspacePlan.views !== undefined && workspacePlan.panes !== undefined
        ? buildDocumentEvent(workspacePlan as Data, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          })
        : buildDocumentEventFromNodes(plan.knowledgeDBs, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          });
    return snapshotEvent
      ? events
          .push(snapshotEvent)
          .push(event as UnsignedEvent & EventAttachment)
      : events.push(event as UnsignedEvent & EventAttachment);
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
