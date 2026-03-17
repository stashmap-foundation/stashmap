import {
  List,
  Map,
  Set as ImmutableSetBuilder,
  Set as ImmutableSet,
} from "immutable";
import { UnsignedEvent } from "nostr-tools";
import type { Contacts, Contact, PublicKey, User } from "./identity";
import {
  getNodeContext,
  getNodeText,
  getSemanticID,
  isSearchId,
  shortID,
  withUsersEntryPublicKey,
  createRootAnchor,
} from "./context";
import {
  deleteNodes,
  ensureNodeNativeFields,
  getNode,
  getOwnSystemRoot,
  getSystemRoleText,
  LOG_ROOT_ROLE,
} from "./queries";
import { isRefNode } from "./references";
import {
  newDB,
  type RefTargetSeed,
  type TextSeed,
  Context,
  GraphNode,
  KnowledgeDBs,
  RootSystemRole,
} from "./types";
import { KIND_CONTACTLIST, newTimestamp, msTag } from "./eventProtocol";
import { newNode, newRefNode } from "./nodeFactory";

export type ChildNodeMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

type GraphPlanData = {
  contacts: Contacts;
  user: User;
  knowledgeDBs: KnowledgeDBs;
};

export type GraphPlan = GraphPlanData & {
  publishEvents: List<UnsignedEvent>;
  affectedRoots: ImmutableSet<ID>;
};

type CreateGraphPlanProps = GraphPlanData & {
  publishEvents?: List<UnsignedEvent>;
};

export function updateChildNodeMetadata(
  node: GraphNode,
  metadata: ChildNodeMetadata
): GraphNode {
  return {
    ...node,
    ...("relevance" in metadata ? { relevance: metadata.relevance } : {}),
    ...("argument" in metadata ? { argument: metadata.argument } : {}),
  };
}

function getAnchorSnapshotLabels(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): string[] {
  if (!node.parent) {
    return [];
  }
  const parentNode = getNode(knowledgeDBs, node.parent, node.author);
  if (!parentNode) {
    return [];
  }
  return [
    ...getAnchorSnapshotLabels(knowledgeDBs, parentNode),
    getNodeText(parentNode) || shortID(getSemanticID(knowledgeDBs, parentNode)),
  ];
}

function newContactListEvent(contacts: Contacts, user: User): UnsignedEvent {
  const tags = contacts
    .valueSeq()
    .toArray()
    .map((contact) => {
      if (contact.mainRelay && contact.userName) {
        return ["p", contact.publicKey, contact.mainRelay, contact.userName];
      }
      if (contact.mainRelay) {
        return ["p", contact.publicKey, contact.mainRelay];
      }
      if (contact.userName) {
        return ["p", contact.publicKey, "", contact.userName];
      }
      return ["p", contact.publicKey];
    });
  return {
    kind: KIND_CONTACTLIST,
    pubkey: user.publicKey,
    created_at: newTimestamp(),
    tags: [...tags, msTag()],
    content: "",
  };
}

function upsertNodesCore<T extends GraphPlan>(plan: T, node: GraphNode): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const normalizedNode = ensureNodeNativeFields(plan.knowledgeDBs, node);
  const updatedNodes = userDB.nodes.set(
    shortID(normalizedNode.id),
    normalizedNode
  );
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    affectedRoots: plan.affectedRoots.add(normalizedNode.root),
  };
}

export function createGraphPlan(props: CreateGraphPlanProps): GraphPlan {
  return {
    ...props,
    publishEvents: props.publishEvents || List<UnsignedEvent>([]),
    affectedRoots: ImmutableSet<ID>(),
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
    publishEvents: plan.publishEvents.push(contactListEvent),
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
  const newContacts = publicKeys.reduce((acc, publicKey) => {
    if (acc.has(publicKey)) {
      return acc;
    }
    return acc.set(publicKey, { publicKey });
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

function addCrefToLog<T extends GraphPlan>(plan: T, nodeID: LongID): T {
  const [planWithLog, logNode] = planEnsureSystemRoot(plan, LOG_ROOT_ROLE);
  const crefNode = newRefNode(
    plan.user.publicKey,
    logNode.root as LongID,
    nodeID,
    logNode.id as LongID
  );
  const planWithCref = upsertNodesCore(planWithLog, crefNode);
  return upsertNodesCore(planWithCref, {
    ...logNode,
    children: logNode.children.insert(0, crefNode.id),
  });
}

export function planUpsertNodes<T extends GraphPlan>(
  plan: T,
  node: GraphNode
): T {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const isNewNode = !userDB.nodes.has(shortID(node.id));
  const basePlan = upsertNodesCore(plan, node);

  const isRootNode = isNewNode && !node.parent;
  const shouldAddToLog = isRootNode && node.systemRole === undefined;
  if (!shouldAddToLog) {
    return basePlan;
  }
  return addCrefToLog(basePlan, node.id);
}

function getWritableNode(
  plan: GraphPlan,
  nodeId: LongID
): GraphNode | undefined {
  const node = getNode(plan.knowledgeDBs, nodeId, plan.user.publicKey);
  if (!node || node.author !== plan.user.publicKey) {
    return undefined;
  }
  return node;
}

function getChildNodeIndex(
  node: GraphNode,
  childNodeId: ID
): number | undefined {
  const index = node.children.findIndex((nodeID) => nodeID === childNodeId);
  return index >= 0 ? index : undefined;
}

function requireChildNode(
  plan: GraphPlan,
  parentNode: GraphNode,
  childNodeId: ID
): GraphNode | undefined {
  const index = getChildNodeIndex(parentNode, childNodeId);
  const nodeID =
    index === undefined ? undefined : parentNode.children.get(index);
  return nodeID
    ? getNode(plan.knowledgeDBs, nodeID, plan.user.publicKey)
    : undefined;
}

export function planUpdateChildNodeMetadataById<T extends GraphPlan>(
  plan: T,
  parentNodeId: LongID,
  childNodeId: ID,
  metadata: ChildNodeMetadata
): T {
  const parentNode = getWritableNode(plan, parentNodeId);
  if (!parentNode) {
    return plan;
  }
  const nodeIndex = getChildNodeIndex(parentNode, childNodeId);
  if (nodeIndex === undefined) {
    return plan;
  }
  const childNode = requireChildNode(plan, parentNode, childNodeId);
  return childNode
    ? planUpsertNodes(plan, updateChildNodeMetadata(childNode, metadata))
    : plan;
}

export type AddToParentTarget = ID | TextSeed | RefTargetSeed;

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

  const [planWithChildren, childPayload] = targetsArray.reduce<
    [T, ChildPayload[]]
  >(
    ([accPlan, accItems], objectOrID) => {
      const refTarget =
        typeof objectOrID !== "string" && "targetID" in objectOrID
          ? objectOrID
          : undefined;
      const objectID: ID = (() => {
        if (typeof objectOrID === "string") {
          return objectOrID;
        }
        if ("id" in objectOrID) {
          return objectOrID.id;
        }
        return objectOrID.targetID;
      })();
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
        return [planWithChild, [...accItems, { childID: childNode.id }]];
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
          [...accItems, { childID: updatedChild.id }],
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
        [...accItems, { childID: nodeWithMetadata.id }],
      ];
    },
    [plan, []]
  );

  const insertedNode = childPayload.reduce<GraphNode>(
    (acc, child, currentIndex) => {
      const order =
        insertAtIndex !== undefined ? insertAtIndex + currentIndex : undefined;
      const defaultOrder = acc.children.size;
      const withPush = {
        ...acc,
        children: acc.children.push(child.childID),
      };
      return order !== undefined && order !== defaultOrder
        ? {
            ...withPush,
            children: withPush.children
              .filter((_, index) => index !== defaultOrder)
              .splice(order, 0, child.childID),
          }
        : withPush;
    },
    parentNode
  );

  return [
    planUpsertNodes(planWithChildren, insertedNode),
    childPayload.map((child) => child.childID),
  ];
}

function getNodeDepth(
  nodesByID: Map<ID, GraphNode>,
  node: GraphNode,
  seen: ImmutableSet<ID> = ImmutableSet<ID>()
): number {
  if (!node.parent) {
    return 0;
  }
  const parentID = shortID(node.parent) as ID;
  if (seen.has(parentID)) {
    return 0;
  }
  const parentNode = nodesByID.get(parentID);
  if (!parentNode) {
    return 0;
  }
  return 1 + getNodeDepth(nodesByID, parentNode, seen.add(parentID));
}

function getEffectiveParentNodeID(node: GraphNode): LongID | undefined {
  return node.parent;
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

  const collectSubtree = (
    currentNode: GraphNode,
    seen: ImmutableSet<LongID>
  ): [List<GraphNode>, ImmutableSet<LongID>] => {
    if (seen.has(currentNode.id) || !filterNode(currentNode)) {
      return [List<GraphNode>(), seen];
    }
    const nextSeen = seen.add(currentNode.id);
    const children = childrenByParent
      .get(currentNode.id, List<GraphNode>())
      .sortBy((node) => getNodeDepth(authorNodesByID, node));
    return children.reduce<[List<GraphNode>, ImmutableSet<LongID>]>(
      ([collectedNodes, collectedSeen], childNode) => {
        const [childNodes, nextChildSeen] = collectSubtree(
          childNode,
          collectedSeen
        );
        return [collectedNodes.concat(childNodes).toList(), nextChildSeen];
      },
      [List<GraphNode>([currentNode]), nextSeen]
    );
  };

  return filterNode(sourceNode)
    ? collectSubtree(sourceNode, ImmutableSet<LongID>())[0]
    : List<GraphNode>();
}

type NodesIdMapping = Map<LongID, LongID>;

export function planCopyDescendantNodes<T extends GraphPlan>(
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
      const copiedParentID = (() => {
        if (isRootNode) {
          return targetParentNodeID;
        }
        if (sourceParentID) {
          return resultMapping.get(sourceParentID);
        }
        return undefined;
      })();
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

export function planRemoveChildNodeById<T extends GraphPlan>(
  plan: T,
  parentNodeId: LongID,
  childNodeId: ID,
  preserveDescendants = false
): T {
  const parentNode = getWritableNode(plan, parentNodeId);
  if (!parentNode) {
    return plan;
  }
  const nodeIndex = getChildNodeIndex(parentNode, childNodeId);
  if (nodeIndex === undefined) {
    return plan;
  }
  const childNode = requireChildNode(plan, parentNode, childNodeId);
  const withoutChildNode = planUpsertNodes(
    plan,
    deleteNodes(parentNode, ImmutableSetBuilder([nodeIndex]))
  );
  if (!childNode || isRefNode(childNode)) {
    return withoutChildNode;
  }
  const sourceNode = getNode(
    withoutChildNode.knowledgeDBs,
    childNode.id,
    withoutChildNode.user.publicKey
  );
  if (!sourceNode) {
    return withoutChildNode;
  }
  if (preserveDescendants) {
    return planMoveDescendantNodes(
      withoutChildNode,
      sourceNode,
      getNodeContext(withoutChildNode.knowledgeDBs, sourceNode),
      undefined,
      undefined,
      shortID(sourceNode.id)
    );
  }
  return planDeleteNodes(
    planDeleteDescendantNodes(withoutChildNode, sourceNode),
    sourceNode.id
  );
}
