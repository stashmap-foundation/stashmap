/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data, no-continue, no-nested-ternary */
import { List, Map, Set as ImmutableSet } from "immutable";
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
  newDocumentPath,
  workspaceDocumentKey,
} from "./Document";
import { entityIdForText } from "./entityRecognition";
import { feedLinkSpans, isBareIcalFeedUrl } from "./ical";
import { isThingAddress } from "./linkPath";
import { getWorkspaceNode, withWorkspace, workspaceOf } from "./knowledge";
import { newGraphNode, newRowKey } from "./nodeFactory";
import { LOCAL, pathOf, rowIdOf, rowKey } from "./nodeRef";
import { getAllLinks, linkSpan, nodeText, plainSpans } from "./nodeSpans";
import {
  LOG_ROOT_FILE,
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
  "user" | "knowledgeDBs" | "graphIndex" | "documents"
>;

export type GraphPlan = GraphPlanData & {
  publishEvents: List<CoreOutboundEvent & EventAttachment>;
  affectedDocuments: ImmutableSet<string>;
  deletedDocs: ImmutableSet<string>;
};

function planEnsureSystemRoot<T extends GraphPlan>(
  plan: T,
  systemRole: RootSystemRole
): [T, GraphNode] {
  const existing = getOwnSystemRoot(plan.knowledgeDBs, systemRole);
  if (existing) {
    return [plan, existing];
  }

  const node = newGraphNode(plainSpans(getSystemRoleText(systemRole)), {
    id: newRowKey(LOG_ROOT_FILE),
    systemRole,
  });

  return [upsertNodesCore(plan, node), node];
}

export function planUpsertRootDocument<T extends GraphPlan>(
  plan: T,
  rootNode: GraphNode
): T {
  if (rootNode.parent) {
    return plan;
  }
  const key = workspaceDocumentKey(pathOf(rootNode.id));
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

export function planMarkDocumentAffected<T extends GraphPlan>(
  plan: T,
  node: GraphNode
): T {
  return {
    ...plan,
    affectedDocuments: plan.affectedDocuments.add(pathOf(node.id)),
  };
}

export function upsertNodesCore<T extends GraphPlan>(
  plan: T,
  nodes: GraphNode
): T {
  const userDB = workspaceOf(plan.knowledgeDBs);
  const node = ensureNodeNativeFields(userDB, nodes);
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

// Log entries are plain block links — the reserved non-projecting form.
// They mean "you created this, here's the way there", never "that node
// here with my overlay below": an unfolding Log would swallow edits as
// Log-file overlays nobody asked for.
function addCrefToLog<T extends GraphPlan>(plan: T, nodeID: ID): T {
  const [planWithLog, nodes] = planEnsureSystemRoot(plan, LOG_ROOT_ROLE);
  const targetNode = getWorkspaceNode(planWithLog.knowledgeDBs, nodeID);
  const crefNode = newGraphNode(
    [
      linkSpan(
        { sourceId: LOCAL, id: nodeID },
        { sourceId: LOCAL, id: nodes.id },
        targetNode ? nodeText(targetNode) : ""
      ),
    ],
    {
      id: newRowKey(pathOf(nodes.id)),
      root: nodes.root,
      parent: nodes.id,
    }
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
    return {
      ...plan,
      knowledgeDBs: nextKnowledgeDBs,
      documents: plan.documents.set(key, nextDocument),
      affectedDocuments: plan.affectedDocuments.add(docId),
      deletedDocs: plan.deletedDocs.remove(docId),
    };
  }

  return {
    ...plan,
    knowledgeDBs: nextKnowledgeDBs,
    documents: plan.documents.remove(key),
    affectedDocuments: plan.affectedDocuments.remove(docId),
    deletedDocs: plan.deletedDocs.add(docId),
  };
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
  if (!node.parent) {
    return planDeleteDocumentRoot(
      plan,
      node,
      nextKnowledgeDBs,
      pathOf(node.id)
    );
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

type CreateGraphPlanProps = GraphPlanData & {
  publishEvents?: List<CoreOutboundEvent & EventAttachment>;
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

// The materialization seam (idea.md: write gestures take first; the
// canonical-id law). A computed row proposes — plain data: its synthetic
// node, its parent, and nearest-first anchors of the display rows above
// it — and the workspace disposes: id absent → mint the node at the
// anchor position; id homed elsewhere → a link row targeting it; id
// already under this parent → no-op (stale row). Overlay-agnostic: the
// interpreter never learns what produced the row.
export type MaterializableRow = {
  node: GraphNode;
  parentRef?: NodeRef;
  materialize?: {
    precededBy: ID[];
    // A prepared take: materialize by adding THIS target (a link row or
    // document link) instead of minting the row's node.
    take?: AddToParentTarget;
    // Judgment defaults inherited from the proposal's source, applied
    // when the gesture carries none.
    defaults?: { relevance?: Relevance; argument?: Argument };
    // The row's parent when that parent is itself computed: the take
    // materializes the host first, then lands under what it returns.
    host?: MaterializableRow;
    root?: true;
  };
};

function materializeInsertIndex(
  plan: GraphPlan,
  parentNode: GraphNode,
  precededBy: ID[]
): number {
  const matchesAnchor = (childId: ID, anchor: ID): boolean => {
    if (childId === anchor) return true;
    const child = getWorkspaceNode(plan.knowledgeDBs, childId);
    return child
      ? getAllLinks(child, LOCAL).some((link) => link.target.id === anchor)
      : false;
  };
  const children = parentNode.children.toArray();
  const found = precededBy
    .map((anchor) =>
      children.findIndex((childId) => matchesAnchor(childId, anchor))
    )
    .find((index) => index >= 0);
  return found !== undefined ? found + 1 : 0;
}

export function planMaterializeComputedRow<
  T extends GraphPlan & Pick<Data, "panes"> & { paneUpdate: boolean }
>(
  plan: T,
  row: MaterializableRow,
  metadata?: { relevance?: Relevance; argument?: Argument },
  placement?: { parentID?: ID; insertIndex?: number }
): [T, GraphNode, boolean] {
  if (!row.materialize) {
    return [plan, row.node, false];
  }
  if (row.materialize.root) {
    const rootNode: GraphNode = {
      ...newGraphNode(row.node.spans, {
        id: newRowKey(newDocumentPath(plan.documents, nodeText(row.node))),
      }),
      relevance: metadata?.relevance,
      argument: metadata?.argument,
    };
    const planWithRoot = planUpsertNodes(
      {
        ...plan,
        paneUpdate: true,
        panes: plan.panes.map((pane) =>
          pane.sourceId === LOCAL && pane.rootNodeId === row.node.id
            ? {
                ...pane,
                rootNodeId: rootNode.id,
                documentId: pathOf(rootNode.id),
                fallbackLabel: undefined,
              }
            : pane
        ),
      },
      rootNode
    );
    const materializedRoot = getWorkspaceNode(
      planWithRoot.knowledgeDBs,
      rootNode.id
    );
    return [planWithRoot, materializedRoot ?? rootNode, true];
  }
  const parentID = placement?.parentID ?? row.parentRef?.id;
  if (parentID === undefined) {
    return [plan, row.node, false];
  }
  const parentNode = getWorkspaceNode(plan.knowledgeDBs, parentID);
  if (!parentNode) {
    const { host } = row.materialize;
    if (!host) {
      return [plan, row.node, false];
    }
    const [planWithHost, hostNode] = planMaterializeComputedRow(plan, host);
    if (!getWorkspaceNode(planWithHost.knowledgeDBs, hostNode.id)) {
      return [plan, row.node, false];
    }
    return planMaterializeComputedRow(planWithHost, row, metadata, {
      parentID: hostNode.id,
      insertIndex: placement?.insertIndex,
    });
  }
  const placedChildId = parentNode.children.find((childId) => {
    if (childId === row.node.id) {
      return true;
    }
    const child = getWorkspaceNode(plan.knowledgeDBs, childId);
    return child
      ? getAllLinks(child, LOCAL).some((link) => link.target.id === row.node.id)
      : false;
  });
  if (placedChildId !== undefined) {
    const already = getWorkspaceNode(plan.knowledgeDBs, placedChildId);
    return [plan, already ?? row.node, false];
  }
  const insertIndex =
    placement?.insertIndex ??
    materializeInsertIndex(plan, parentNode, row.materialize.precededBy);
  if (row.materialize.take !== undefined) {
    const [planWithTake, ids] = planAddTargetsToNode(
      plan,
      parentID,
      row.materialize.take,
      insertIndex,
      metadata?.relevance ?? row.materialize.defaults?.relevance,
      metadata?.argument ?? row.materialize.defaults?.argument
    );
    const takenNode = getWorkspaceNode(planWithTake.knowledgeDBs, ids[0]);
    return [planWithTake, takenNode ?? row.node, true];
  }
  if (isThingAddress(row.node.id)) {
    const [planWithPlacement, ids] = planAddTargetsToNode(
      plan,
      parentID,
      {
        target: { sourceId: LOCAL, id: row.node.id },
        linkText: nodeText(row.node),
      },
      insertIndex,
      metadata?.relevance ?? row.materialize.defaults?.relevance,
      metadata?.argument ?? row.materialize.defaults?.argument
    );
    const placementNode = getWorkspaceNode(
      planWithPlacement.knowledgeDBs,
      ids[0]
    );
    return [planWithPlacement, placementNode ?? row.node, true];
  }
  const existing = getWorkspaceNode(plan.knowledgeDBs, row.node.id);
  if (existing) {
    // Homed elsewhere: this placement becomes a link row (mint or link,
    // never duplicate) and the gesture applies to the link — judgment at
    // a placement is placement-local.
    const [planWithLink, ids] = planAddTargetsToNode(
      plan,
      parentID,
      {
        target: { sourceId: LOCAL, id: row.node.id },
        linkText: nodeText(existing),
      },
      insertIndex,
      metadata?.relevance,
      metadata?.argument
    );
    const linkNode = getWorkspaceNode(planWithLink.knowledgeDBs, ids[0]);
    return [planWithLink, linkNode ?? row.node, true];
  }
  // The mint carries the user's explicit judgment or none at all —
  // projection rows enter the file unjudged.
  const minted: GraphNode = {
    ...row.node,
    id: rowKey(pathOf(parentID), rowIdOf(row.node.id)),
    parent: parentID,
    root: parentNode.root,
    updated: Date.now(),
    relevance: metadata?.relevance,
    argument: metadata?.argument,
  };
  const planWithNode = planUpsertNodes(plan, minted);
  const [planAttached] = planAddTargetsToNode(
    planWithNode,
    parentID,
    minted.id,
    insertIndex
  );
  const node = getWorkspaceNode(planAttached.knowledgeDBs, minted.id);
  return [planAttached, node ?? minted, true];
}

// The listening side of publication (idea.md): machine-written at the
// moment an embed is created — the one moment the source is known for
// certain. One entry per source document; entries are cache, a stale one
// costs a lookup, never correctness.
export function planRecordKnowstrSource<T extends GraphPlan>(
  plan: T,
  targetNode: GraphNode,
  source: { author: string; path: string; relays: string[] }
): T {
  const docId = pathOf(targetNode.id);
  const key = workspaceDocumentKey(docId);
  const document = plan.documents.get(key);
  if (!document) {
    return plan;
  }
  const recorded = document.frontMatter?.knowstr_sources;
  const existing: unknown[] = Array.isArray(recorded) ? recorded : [];
  const alreadyRecorded = existing.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "author" in entry &&
      entry.author === source.author &&
      "path" in entry &&
      entry.path === source.path
  );
  if (alreadyRecorded) {
    return plan;
  }
  const nextDocument: Document = {
    ...document,
    frontMatter: {
      ...document.frontMatter,
      knowstr_sources: [...existing, source],
    },
  };
  return {
    ...plan,
    documents: plan.documents.set(key, nextDocument),
    affectedDocuments: plan.affectedDocuments.add(docId),
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

  const parentRef = { sourceId: LOCAL, id: parentNode.id };
  const childOptions = {
    root: parentNode.root,
    parent: parentNode.id,
    relevance,
    argument,
  };
  const [planWithChildren, nodeItemPayload] = targetsArray.reduce<
    [T, ChildPayload[]]
  >(
    ([accPlan, accItems], objectOrID) => {
      const refTarget =
        typeof objectOrID !== "string" && "target" in objectOrID
          ? objectOrID
          : undefined;
      const documentLinkTarget =
        typeof objectOrID !== "string" && "docId" in objectOrID
          ? objectOrID
          : undefined;
      if (documentLinkTarget) {
        const childNode = newGraphNode(
          [
            linkSpan(
              {
                sourceId: documentLinkTarget.sourceId,
                id: documentLinkTarget.docId,
              },
              parentRef,
              documentLinkTarget.linkText || ""
            ),
          ],
          { ...childOptions, id: newRowKey(pathOf(parentNode.id)) }
        );
        return [
          planUpsertNodes(accPlan, childNode),
          [...accItems, { childID: childNode.id }],
        ];
      }
      if (refTarget) {
        const childNode = {
          ...newGraphNode(
            [linkSpan(refTarget.target, parentRef, refTarget.linkText || "")],
            { ...childOptions, id: newRowKey(pathOf(parentNode.id)) }
          ),
          extraAttrs: { embed: "true" },
        };
        const planWithChild = planUpsertNodes(accPlan, childNode);
        const sourceNode =
          refTarget.target.sourceId === LOCAL
            ? getWorkspaceNode(planWithChild.knowledgeDBs, refTarget.target.id)
            : undefined;
        return [
          sourceNode
            ? planMarkDocumentAffected(planWithChild, sourceNode)
            : planWithChild,
          [...accItems, { childID: childNode.id }],
        ];
      }
      if (typeof objectOrID === "string" && isSearchId(objectOrID)) {
        const searchNode: GraphNode = {
          children: List<ID>(),
          id: objectOrID,
          spans: plainSpans(""),
          parent: parentNode.id,
          updated: Date.now(),
          root: parentNode.root,
          relevance,
          argument,
        };
        return [
          planUpsertNodes(accPlan, searchNode),
          [...accItems, { childID: searchNode.id }],
        ];
      }

      const existingNode =
        typeof objectOrID === "string"
          ? getWorkspaceNode(accPlan.knowledgeDBs, objectOrID)
          : undefined;
      if (existingNode) {
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

      const objectText =
        typeof objectOrID !== "string" && "text" in objectOrID
          ? objectOrID.text
          : "";
      const thing = entityIdForText(objectText);
      const feedSpans =
        !thing && isBareIcalFeedUrl(objectText)
          ? feedLinkSpans(objectText)
          : undefined;
      const childSpans: InlineSpan[] = thing
        ? [{ kind: "link", href: thing, text: objectText.trim() }]
        : feedSpans ?? plainSpans(objectText);
      const childNode = {
        ...newGraphNode(childSpans, {
          ...childOptions,
          id: newRowKey(pathOf(parentNode.id)),
        }),
        ...(feedSpans && { extraAttrs: { embed: "true" } }),
      };
      return [
        planUpsertNodes(accPlan, childNode),
        [...accItems, { childID: childNode.id }],
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
      const refTarget =
        typeof target !== "string" && "target" in target ? target : undefined;
      const id = newRowKey(document.docId);
      const from = { sourceId: LOCAL, id };
      const topNodeSpans = documentLinkTarget
        ? [
            linkSpan(
              {
                sourceId: documentLinkTarget.sourceId,
                id: documentLinkTarget.docId,
              },
              from,
              documentLinkTarget.linkText || ""
            ),
          ]
        : refTarget
        ? [linkSpan(refTarget.target, from, refTarget.linkText || "")]
        : [];
      if (topNodeSpans.length === 0) {
        return [accPlan, accIds];
      }
      const topNode = {
        ...newGraphNode(topNodeSpans, { id, relevance, argument }),
        ...(refTarget && { extraAttrs: { embed: "true" } }),
      };
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
