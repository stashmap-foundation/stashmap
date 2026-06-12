/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import { List, Map, Set as ImmutableSet } from "immutable";
import { v4 } from "uuid";
import { KIND_RELAY_METADATA_EVENT, newTimestamp, msTag } from "../nostr";
import { ensureNodeNativeFields, isSearchId } from "./connections";
import type {
  DocumentLinkTargetSeed,
  RefTargetSeed,
  TextSeed,
} from "./connections";
import {
  createDocumentFromRootNode,
  Document,
  documentKeyOf,
  workspaceDocumentKey,
} from "./Document";
import { getWorkspaceNode, withWorkspace, workspaceOf } from "./knowledge";
import { newGraphNode } from "./nodeFactory";
import { fileLinkSpan, linkSpan, plainSpans } from "./nodeSpans";
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
  | "user"
  | "knowledgeDBs"
  | "snapshotNodes"
  | "graphIndex"
  | "documents"
  | "documentByFilePath"
  | "relaysInfos"
>;

export type GraphPlan = GraphPlanData & {
  publishEvents: List<CoreOutboundEvent & EventAttachment>;
  affectedDocuments: ImmutableSet<string>;
  deletedDocs: ImmutableSet<string>;
  relays: AllRelays;
};

function planEnsureSystemRoot<T extends GraphPlan>(
  plan: T,
  systemRole: RootSystemRole
): [T, GraphNode] {
  const existing = getOwnSystemRoot(plan.knowledgeDBs, systemRole);
  if (existing) {
    return [plan, existing];
  }

  const node = withDocumentRoot(
    newGraphNode(plainSpans(getSystemRoleText(systemRole)), {
      systemRole,
    })
  );

  return [upsertNodesCore(plan, node), node];
}

export function planUpsertRootDocument<T extends GraphPlan>(
  plan: T,
  rootNode: GraphNode
): T {
  if (rootNode.parent || !rootNode.docId) {
    return plan;
  }
  const key = workspaceDocumentKey(rootNode.docId);
  const existing = plan.documents.get(key);
  const next = existing
    ? {
        ...existing,
        topNodeShortIds: existing.topNodeShortIds.includes(rootNode.id)
          ? existing.topNodeShortIds
          : [...existing.topNodeShortIds, rootNode.id],
        updatedMs: rootNode.updated,
      }
    : createDocumentFromRootNode(rootNode);
  return { ...plan, documents: plan.documents.set(key, next) };
}

export function withDocumentRoot(
  node: GraphNode,
  docId: string = v4()
): GraphNode {
  if (node.parent) {
    throw new Error("Only top-level nodes can become document roots");
  }
  return { ...node, docId };
}

export function getNodeDocumentId(
  plan: Pick<GraphPlan, "knowledgeDBs">,
  node: GraphNode
): string | undefined {
  return node.docId ?? getWorkspaceNode(plan.knowledgeDBs, node.root)?.docId;
}

export function planMarkDocumentAffected<T extends GraphPlan>(
  plan: T,
  node: GraphNode
): T {
  const docId = getNodeDocumentId(plan, node);
  return docId
    ? { ...plan, affectedDocuments: plan.affectedDocuments.add(docId) }
    : plan;
}

export function upsertNodesCore<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
  const userDB = workspaceOf(plan.knowledgeDBs);
  const normalized = ensureNodeNativeFields(userDB, nodes);
  const node: GraphNode =
    !normalized.parent && !normalized.docId
      ? { ...normalized, docId: v4() }
      : normalized;
  const updatedDB = {
    ...userDB,
    nodes: userDB.nodes.set(node.id, node),
  };
  const planWithNode: T = {
    ...plan,
    knowledgeDBs: withWorkspace(plan.knowledgeDBs, updatedDB),
  };
  return planMarkDocumentAffected(
    planUpsertRootDocument(planWithNode, node),
    node
  );
}

function addCrefToLog<T extends GraphPlan>(plan: T, nodeID: ID): T {
  const [planWithLog, nodes] = planEnsureSystemRoot(plan, LOG_ROOT_ROLE);
  const crefNode = newGraphNode([linkSpan(nodeID, "")], {
    root: nodes.root as ID,
    parent: nodes.id as ID,
  });
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
  const userDB = workspaceOf(plan.knowledgeDBs);
  const isNewNode = !userDB.nodes.has(nodes.id);
  const basePlan = upsertNodesCore(plan, nodes);

  const isRootNode = isNewNode && !nodes.parent;
  const shouldAddToLog = isRootNode && nodes.systemRole === undefined;
  if (!shouldAddToLog) {
    return basePlan;
  }
  return addCrefToLog(basePlan, nodes.id);
}

type NodesIdMapping = Map<ID, ID>;

function getEffectiveParentNodeID(node: GraphNode): ID | undefined {
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
    const parentID: ID = currentNode.parent;
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
  sourceGraph: KnowledgeData,
  sourceNode: GraphNode,
  filterNode: (node: GraphNode) => boolean = () => true
): List<GraphNode> {
  const authorNodesByID = sourceGraph.nodes;
  const childrenByParent = authorNodesByID
    .valueSeq()
    .filter((node) => node.root === sourceNode.root)
    .reduce((acc, node) => {
      const parentID = getEffectiveParentNodeID(node);
      if (!parentID) {
        return acc;
      }
      return acc.update(parentID, List<GraphNode>(), (nodes) =>
        nodes.push(node)
      );
    }, Map<ID, List<GraphNode>>());

  const ordered: GraphNode[] = [];
  const queue: GraphNode[] = filterNode(sourceNode) ? [sourceNode] : [];
  const seen = new Set<ID>(queue.map((node) => node.id));

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
  sourceGraph: KnowledgeData,
  sourceNode: GraphNode,
  targetParentNodeID?: ID,
  root?: ID
): [T, NodesIdMapping] {
  const descendants = getNodeSubtree(sourceGraph, sourceNode);

  const { copiedNodes } = descendants.reduce(
    (acc, node) => {
      const baseNode = newGraphNode(node.spans, {
        root: acc.copiedRoot,
      });
      const nextCopiedRoot = acc.copiedRoot ?? baseNode.root;
      return {
        copiedRoot: nextCopiedRoot,
        copiedNodes: acc.copiedNodes.push({
          source: node,
          sourceParentID: getEffectiveParentNodeID(node),
          copy: baseNode,
        }),
      };
    },
    {
      copiedRoot: root,
      copiedNodes: List<{
        source: GraphNode;
        sourceParentID?: ID;
        copy: GraphNode;
      }>(),
    }
  );

  const resultMapping = copiedNodes.reduce(
    (acc, { source, copy }) => acc.set(source.id, copy.id),
    Map<ID, ID>()
  );

  const resultPlan = copiedNodes.reduce(
    (accPlan, { source, sourceParentID, copy }) => {
      const isRootNode = source.id === sourceNode.id;
      const children = source.children.map((childID) => {
        const mappedID = resultMapping.get(childID as ID);
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
        spans: source.spans,
        basedOn: source.id,
        relevance: source.relevance,
        argument: source.argument,
      });
    },
    plan
  );

  return [planMarkDocumentAffected(resultPlan as T, sourceNode), resultMapping];
}

export function planMoveDescendantNodes<T extends GraphPlan>(
  plan: T,
  sourceNode: GraphNode,
  targetParentNodeID?: ID,
  root?: ID
): T {
  const descendants = getNodeSubtree(
    workspaceOf(plan.knowledgeDBs),
    sourceNode
  );
  return descendants.reduce((accPlan, node) => {
    const isRootNode = node.id === sourceNode.id;
    return planUpsertNodes(accPlan, {
      ...node,
      parent: isRootNode ? targetParentNodeID : getEffectiveParentNodeID(node),
      root: root ?? node.root,
    });
  }, plan);
}

function withDocumentInFilePathIndex<T extends GraphPlan>(
  plan: T,
  document: Document
): T {
  return document.filePath
    ? {
        ...plan,
        documentByFilePath: plan.documentByFilePath.set(
          document.filePath,
          document
        ),
      }
    : plan;
}

function withoutDocumentInFilePathIndex<T extends GraphPlan>(
  plan: T,
  document: Document | undefined
): T {
  if (!document?.filePath) {
    return plan;
  }
  const current = plan.documentByFilePath.get(document.filePath);
  return current?.docId === document.docId
    ? {
        ...plan,
        documentByFilePath: plan.documentByFilePath.remove(document.filePath),
      }
    : plan;
}

function planDeleteDocumentRoot<T extends GraphPlan>(
  plan: T,
  node: GraphNode,
  nextKnowledgeDBs: KnowledgeDBs,
  docId: string
): T {
  const key = workspaceDocumentKey(docId);
  const document = plan.documents.get(key);
  const remainingTopNodeShortIds =
    document?.topNodeShortIds.filter((id) => id !== node.id) ?? [];

  if (document && remainingTopNodeShortIds.length > 0) {
    const nextDocument: Document = {
      ...document,
      topNodeShortIds: remainingTopNodeShortIds,
      updatedMs: Date.now(),
    };
    return withDocumentInFilePathIndex(
      {
        ...plan,
        knowledgeDBs: nextKnowledgeDBs,
        documents: plan.documents.set(key, nextDocument),
        affectedDocuments: plan.affectedDocuments.add(docId),
        deletedDocs: plan.deletedDocs.remove(docId),
      },
      nextDocument
    );
  }

  return withoutDocumentInFilePathIndex(
    {
      ...plan,
      knowledgeDBs: nextKnowledgeDBs,
      documents: plan.documents.remove(key),
      affectedDocuments: plan.affectedDocuments.remove(docId),
      deletedDocs: plan.deletedDocs.add(docId),
    },
    document
  );
}

export function planDeleteNodes<T extends GraphPlan>(plan: T, nodeID: ID): T {
  const userDB = workspaceOf(plan.knowledgeDBs);
  const node = userDB.nodes.get(nodeID);
  const updatedNodes = userDB.nodes.remove(nodeID);
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const nextKnowledgeDBs = withWorkspace(plan.knowledgeDBs, updatedDB);
  if (!node) {
    return { ...plan, knowledgeDBs: nextKnowledgeDBs };
  }
  const { docId } = node;
  if (!node.parent && docId) {
    return planDeleteDocumentRoot(plan, node, nextKnowledgeDBs, docId);
  }
  return {
    ...plan,
    knowledgeDBs: nextKnowledgeDBs,
    affectedDocuments: planMarkDocumentAffected(plan, node).affectedDocuments,
  };
}

export function planDeleteDescendantNodes<T extends GraphPlan>(
  plan: T,
  sourceNode: GraphNode
): T {
  const workspace = workspaceOf(plan.knowledgeDBs);
  const descendants = getNodeSubtree(workspace, sourceNode)
    .filter((node) => node.id !== sourceNode.id)
    .sortBy((node) => -getNodeParentDepth(workspace.nodes, node));

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
    pubkey: "",
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
    affectedDocuments: ImmutableSet<string>(),
    deletedDocs: ImmutableSet<string>(),
  };
}

export type AddToParentTarget =
  | ID
  | TextSeed
  | RefTargetSeed
  | DocumentLinkTargetSeed;

export function planAddTargetsToNode<T extends GraphPlan>(
  plan: T,
  parentID: ID,
  targets: AddToParentTarget | AddToParentTarget[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): [T, ID[]] {
  type ChildPayload = {
    childID: ID;
  };

  const parentNode = getWorkspaceNode(plan.knowledgeDBs, parentID);
  const targetsArray = Array.isArray(targets) ? targets : [targets];
  if (!parentNode || targetsArray.length === 0) {
    return [plan, []];
  }

  const [planWithChildren, nodeItemPayload] = targetsArray.reduce<
    [T, ChildPayload[]]
  >(
    ([accPlan, accItems], objectOrID) => {
      const refTarget =
        typeof objectOrID !== "string" && "targetID" in objectOrID
          ? objectOrID
          : undefined;
      const documentLinkTarget =
        typeof objectOrID !== "string" && "docId" in objectOrID
          ? objectOrID
          : undefined;
      if (documentLinkTarget) {
        const childNode = newGraphNode(
          [
            fileLinkSpan(
              documentLinkTarget.filePath ?? documentLinkTarget.docId,
              documentLinkTarget.linkText || ""
            ),
          ],
          {
            root: parentNode.root,
            parent: parentNode.id,
            relevance,
            argument,
          }
        );
        return [
          planUpsertNodes(accPlan, childNode),
          [
            ...accItems,
            {
              childID: childNode.id,
            },
          ],
        ];
      }
      const objectID =
        typeof objectOrID === "string"
          ? objectOrID
          : "id" in objectOrID
          ? objectOrID.id
          : "targetID" in objectOrID
          ? objectOrID.targetID
          : objectOrID.docId;
      const objectText =
        typeof objectOrID !== "string" && "text" in objectOrID
          ? objectOrID.text
          : undefined;
      if (refTarget || isSearchId(objectID as ID)) {
        const childNode = refTarget
          ? newGraphNode(
              [linkSpan(refTarget.targetID, refTarget.linkText || "")],
              {
                root: parentNode.root,
                parent: parentNode.id,
                relevance,
                argument,
              }
            )
          : ({
              children: List<ID>(),
              id: objectID,
              spans: plainSpans(""),
              parent: parentNode.id,
              updated: Date.now(),
              root: parentNode.root,
              relevance,
              argument,
            } as GraphNode);
        const planWithChild = planUpsertNodes(accPlan, childNode);
        const sourceNode = refTarget
          ? getWorkspaceNode(planWithChild.knowledgeDBs, refTarget.targetID)
          : undefined;
        const planWithSourceRoot = sourceNode
          ? planMarkDocumentAffected(planWithChild, sourceNode)
          : planWithChild;
        return [
          planWithSourceRoot,
          [
            ...accItems,
            {
              childID: childNode.id,
            },
          ],
        ];
      }

      const existingNode = getWorkspaceNode(accPlan.knowledgeDBs, objectID);
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

      const childNode = newGraphNode(plainSpans(objectText || ""), {
        root: parentNode.root,
        parent: parentNode.id,
      });
      const nodeWithMetadata = {
        ...childNode,
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

export function planAddTopTargetsToDocument<T extends GraphPlan>(
  plan: T,
  document: Document,
  targets: AddToParentTarget | AddToParentTarget[],
  relevance?: Relevance,
  argument?: Argument
): [T, ID[]] {
  const targetsArray = Array.isArray(targets) ? targets : [targets];
  if (targetsArray.length === 0) {
    return [plan, []];
  }

  const [planWithNodes, topNodeIds] = targetsArray.reduce<[T, ID[]]>(
    ([accPlan, accIds], target) => {
      const documentLinkTarget =
        typeof target !== "string" && "docId" in target ? target : undefined;
      if (!documentLinkTarget) {
        return [accPlan, accIds];
      }
      const topNode = newGraphNode(
        [
          fileLinkSpan(
            documentLinkTarget.filePath ?? documentLinkTarget.docId,
            documentLinkTarget.linkText || ""
          ),
        ],
        {
          docId: document.docId,
          relevance,
          argument,
        }
      );
      return [planUpsertNodes(accPlan, topNode), [...accIds, topNode.id]];
    },
    [plan, []]
  );

  if (topNodeIds.length === 0) {
    return [planWithNodes, []];
  }

  const nextDocument: Document = {
    ...document,
    topNodeShortIds: [...document.topNodeShortIds, ...topNodeIds],
    updatedMs: Date.now(),
  };

  return [
    {
      ...planWithNodes,
      documents: planWithNodes.documents.set(
        documentKeyOf(nextDocument.sourceId, nextDocument.docId),
        nextDocument
      ),
      affectedDocuments: planWithNodes.affectedDocuments.add(
        nextDocument.docId
      ),
    },
    topNodeIds,
  ];
}
