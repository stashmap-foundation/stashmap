/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import { List, Map, Set as ImmutableSet } from "immutable";
import {
  KIND_CONTACTLIST,
  KIND_RELAY_METADATA_EVENT,
  newTimestamp,
  msTag,
} from "../nostr";
import {
  ensureNodeNativeFields,
  getNode,
  getNodeContext,
  getNodeText,
  getSemanticID,
  isSearchId,
  shortID,
} from "./connections";
import type { RefTargetSeed, TextSeed } from "./connections";
import { newDB } from "./knowledge";
import { newNode, newRefNode } from "./nodeFactory";
import { nodeText, plainSpans } from "./nodeSpans";
import { createRootAnchor } from "./rootAnchor";
import {
  LOG_ROOT_ROLE,
  getOwnSystemRoot,
  getSystemRoleText,
} from "./systemRoots";

export type CoreOutboundEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
};

type GraphPlanData = Pick<
  Data,
  | "contacts"
  | "user"
  | "contactsRelays"
  | "knowledgeDBs"
  | "snapshotNodes"
  | "semanticIndex"
  | "documents"
  | "documentByFilePath"
  | "relaysInfos"
>;

export type GraphPlan = GraphPlanData & {
  publishEvents: List<CoreOutboundEvent & EventAttachment>;
  affectedRoots: ImmutableSet<ID>;
  deletedDocs: ImmutableSet<string>;
  relays: AllRelays;
};

function newContactListEvent(
  contacts: Contacts,
  user: User
): CoreOutboundEvent {
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
  event: CoreOutboundEvent,
  conf: WriteRelayConf
): CoreOutboundEvent & EventAttachment {
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

export function upsertNodesCore<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
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

type NodesIdMapping = Map<LongID, LongID>;

function getEffectiveParentNodeID(node: GraphNode): LongID | undefined {
  return node.parent;
}

function getNodeParentDepth(
  nodesByID: Map<ID, GraphNode>,
  node: GraphNode
): number {
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
      .sortBy((node) => getNodeParentDepth(authorNodesByID, node));
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
          : nodeText(node),
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
        spans: source.spans,
        basedOn: source.id,
        relevance: source.relevance,
        argument: source.argument,
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
  const nextKnowledgeDBs = plan.knowledgeDBs.set(
    plan.user.publicKey,
    updatedDB
  );
  if (!node) {
    return { ...plan, knowledgeDBs: nextKnowledgeDBs };
  }
  const { docId } = node;
  if (!node.parent && docId) {
    return {
      ...plan,
      knowledgeDBs: nextKnowledgeDBs,
      affectedRoots: plan.affectedRoots.remove(node.root),
      deletedDocs: plan.deletedDocs.add(docId),
    };
  }
  return {
    ...plan,
    knowledgeDBs: nextKnowledgeDBs,
    affectedRoots: plan.affectedRoots.add(node.root),
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
    .sortBy((node) => -getNodeParentDepth(userNodesByID, node));

  return descendants.reduce(
    (accPlan, node) => planDeleteNodes(accPlan, node.id),
    plan
  );
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

export function planPublishRelayMetadata<T extends GraphPlan>(
  plan: T,
  relays: Relays
): T {
  const tags = relayTags(relays);
  const publishRelayMetadataEvent: CoreOutboundEvent & EventAttachment = {
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

type CreateGraphPlanProps = GraphPlanData & {
  publishEvents?: List<CoreOutboundEvent & EventAttachment>;
  relays: AllRelays;
};

export function createGraphPlan(props: CreateGraphPlanProps): GraphPlan {
  return {
    ...props,
    publishEvents:
      props.publishEvents || List<CoreOutboundEvent & EventAttachment>([]),
    affectedRoots: ImmutableSet<ID>(),
    deletedDocs: ImmutableSet<string>(),
  };
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
      const objectUserPublicKey =
        typeof objectOrID !== "string" && "userPublicKey" in objectOrID
          ? objectOrID.userPublicKey
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
              spans: plainSpans(""),
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
      const nodeWithUserPublicKey = objectUserPublicKey
        ? { ...childNode, userPublicKey: objectUserPublicKey }
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
