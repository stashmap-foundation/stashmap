import { List } from "immutable";
import { EMPTY_SEMANTIC_ID } from "../graph/types";
import type {
  KnowledgeDBs,
  Argument,
  GraphNode,
  ID,
  LongID,
  Relevance,
  TextSeed,
} from "../graph/types";
import type { PublicKey } from "../graph/identity";
import { createRefTarget, isRefNode } from "../graph/references";
import {
  getNodeUserPublicKey,
  isEmptySemanticID,
  getSemanticID,
  isSearchId,
  withUsersEntryPublicKey,
} from "../graph/context";
import { getNode, computeEmptyNodeMetadata } from "../graph/queries";
import { newNode } from "../graph/nodeFactory";
import { decodePublicKeyInputSync } from "../graph/publicKeys";
import type { ChildNodeMetadata } from "../graph/commands";
import {
  planUpdateChildNodeMetadataById,
  planUpsertContact,
  planUpsertNodes,
} from "../graph/commands";
import {
  getNodeForView,
  getNodeIndexForView,
  getRowIDFromView,
} from "../rows/resolveRow";
import {
  getParentRowPath,
  rowPathToString,
  type RowPath,
  getPaneIndex,
} from "../rows/rowPaths";
import type { VirtualRowsMap } from "../rows/types";
import { planAddToParent, planDeepCopyNode } from "./treeActions";
import type { Plan } from "./types";
import { upsertNodes } from "./actions";
import { planExpandNode } from "../session/views";

export type { ChildNodeMetadata } from "../graph/commands";

function getNodeText(plan: Plan, rowPath: RowPath, stack: ID[]): string {
  return getNodeForView(plan, rowPath, stack)?.text ?? "";
}

function planUpdateExistingChildNodeMetadata(
  plan: Plan,
  parentRowPath: RowPath,
  stack: ID[],
  childNodeIndex: number,
  metadata: ChildNodeMetadata
): Plan {
  const nodes = getNodeForView(plan, parentRowPath, stack);
  const childNodeId = nodes?.children.get(childNodeIndex);
  return nodes && childNodeId
    ? planUpdateChildNodeMetadataById(plan, nodes.id, childNodeId, metadata)
    : plan;
}

export function planUpdateNodeText(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  text: string
): Plan {
  const currentNode = getNodeForView(plan, rowPath, stack);
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

  const shortNodeID = nodeID.includes("_") ? nodeID.split("_")[1] : nodeID;
  const existingNode = myDB.nodes.get(shortNodeID);
  if (!existingNode) {
    return knowledgeDBs;
  }

  const filteredChildren = existingNode.children.filter(
    (childID) => !isEmptySemanticID(childID)
  );
  if (filteredChildren.size === existingNode.children.size) {
    return knowledgeDBs;
  }

  const updatedNodes = myDB.nodes.set(shortNodeID, {
    ...existingNode,
    children: filteredChildren,
  });
  return knowledgeDBs.set(publicKey, {
    ...myDB,
    nodes: updatedNodes,
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

export function planCreateNode(plan: Plan, text: string): [Plan, TextSeed] {
  return [
    plan,
    {
      id: text as ID,
      text,
    },
  ];
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
    .filter((line) => line.text.length > 0);
}

type SaveNodeResult = {
  plan: Plan;
  rowPath: RowPath;
};

function planCreateNoteAtRoot(
  plan: Plan,
  text: string,
  rowPath: RowPath
): SaveNodeResult {
  const [planWithSeed, createdSeed] = planCreateNode(plan, text);
  const createdNode = withUsersEntryPublicKey(
    newNode(createdSeed.text, List<ID>(), plan.user.publicKey),
    createdSeed.text
  );
  const planWithNode = planUpsertNodes(planWithSeed, createdNode);
  const paneIndex = getPaneIndex(rowPath);
  const newPanes = planWithNode.panes.map((pane, index) =>
    index === paneIndex
      ? {
          ...pane,
          stack: [getSemanticID(planWithNode.knowledgeDBs, createdNode)],
          rootNodeId: createdNode.id,
        }
      : pane
  );
  return {
    plan: {
      ...planWithNode,
      panes: newPanes,
    },
    rowPath: [paneIndex, createdNode.id],
  };
}

export function planSaveNodeAndEnsureNodes(
  plan: Plan,
  text: string,
  rowPath: RowPath,
  stack: ID[],
  relevance?: Relevance,
  argument?: Argument
): SaveNodeResult {
  const trimmedText = text.trim();
  const [rowID] = getRowIDFromView(plan, rowPath);
  const currentNode = getNodeForView(plan, rowPath, stack);
  const parentRowPath = getParentRowPath(rowPath);

  if (isEmptySemanticID(rowID)) {
    if (!parentRowPath) {
      if (!trimmedText) return { plan, rowPath };
      return planCreateNoteAtRoot(plan, trimmedText, rowPath);
    }
    const nodes = getNodeForView(plan, parentRowPath, stack);
    if (!trimmedText) {
      const resultPlan = nodes
        ? planRemoveEmptyNodePosition(plan, nodes.id)
        : plan;
      return { plan: resultPlan, rowPath };
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
      parentRowPath,
      stack,
      emptyNodeIndex,
      relevance ?? metadata?.emptyNode.relevance,
      argument ?? metadata?.emptyNode.argument
    );
    return { plan: resultPlan, rowPath };
  }

  const currentRow = getNode(plan.knowledgeDBs, rowID, plan.user.publicKey);
  if ((currentRow && isRefNode(currentRow)) || isSearchId(rowID as ID)) {
    return { plan, rowPath };
  }

  const displayText = currentNode?.text ?? "";
  if (trimmedText === displayText) {
    return { plan, rowPath };
  }

  return {
    plan: currentNode
      ? planUpdateNodeText(plan, rowPath, stack, trimmedText)
      : plan,
    rowPath,
  };
}

export function getNextInsertPosition(
  plan: Plan,
  rowPath: RowPath,
  nodeIsRoot: boolean,
  nodeIsExpanded: boolean,
  nodeIndex: number | undefined
): [RowPath, ID[], number] | null {
  const paneIndex = rowPath[0];
  const { stack } = plan.panes[paneIndex];

  if (nodeIsRoot || nodeIsExpanded) {
    return [rowPath, stack, 0];
  }

  const parentRowPath = getParentRowPath(rowPath);
  if (!parentRowPath) {
    return null;
  }

  return [parentRowPath, stack, (nodeIndex ?? 0) + 1];
}

export function planSetEmptyNodePosition(
  plan: Plan,
  parentPath: RowPath,
  stack: ID[],
  insertIndex: number
): Plan {
  const planWithOwnNodes = upsertNodes(plan, parentPath, stack, (node) => node);
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

  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID: nodes.id,
      index: insertIndex,
      emptyNode: {
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

  const updatedEmptyNode: GraphNode = {
    ...existing.emptyNode,
    relevance: metadata.relevance ?? existing.emptyNode.relevance,
    argument: metadata.argument ?? existing.emptyNode.argument,
  };

  return {
    ...plan,
    temporaryEvents: plan.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      nodeID,
      index: existing.index,
      emptyNode: updatedEmptyNode,
      paneIndex: existing.paneIndex,
    }),
  };
}

export function planUpdateRowNodeMetadata(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  metadata: ChildNodeMetadata,
  editorText: string,
  virtualRowsMap?: VirtualRowsMap
): Plan {
  const [rowID] = getRowIDFromView(plan, rowPath);
  const parentRowPath = getParentRowPath(rowPath);
  if (!parentRowPath) {
    return plan;
  }

  if (isEmptySemanticID(rowID)) {
    const trimmed = editorText.trim();
    if (trimmed) {
      return planSaveNodeAndEnsureNodes(
        plan,
        trimmed,
        rowPath,
        stack,
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    const nodes = getNodeForView(plan, parentRowPath, stack);
    return nodes ? planUpdateEmptyNodeMetadata(plan, nodes.id, metadata) : plan;
  }

  const childNodeIndex = getNodeIndexForView(plan, rowPath);
  if (childNodeIndex === undefined) {
    const virtualRow = virtualRowsMap?.get(rowPathToString(rowPath));
    if (!virtualRow) {
      return plan;
    }
    if (virtualRow.virtualType === "suggestion" && !isRefNode(virtualRow)) {
      return planDeepCopyNode(
        plan,
        rowPath,
        parentRowPath,
        stack,
        undefined,
        metadata.relevance,
        metadata.argument
      )[0];
    }
    const targetID = virtualRow.targetID || undefined;
    const targetNode = targetID ? createRefTarget(targetID) : rowID;
    const inheritedSourceNode = targetID
      ? getNode(plan.knowledgeDBs, targetID, plan.user.publicKey)
      : undefined;
    return planAddToParent(
      plan,
      targetNode,
      parentRowPath,
      stack,
      undefined,
      metadata.relevance ?? inheritedSourceNode?.relevance,
      metadata.argument ?? inheritedSourceNode?.argument
    )[0];
  }

  const trimmed = editorText.trim();
  const basePlan =
    trimmed && trimmed !== getNodeText(plan, rowPath, stack)
      ? planSaveNodeAndEnsureNodes(plan, editorText, rowPath, stack).plan
      : plan;

  return planUpdateExistingChildNodeMetadata(
    basePlan,
    parentRowPath,
    stack,
    childNodeIndex,
    metadata
  );
}
