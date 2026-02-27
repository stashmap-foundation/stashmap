import { List } from "immutable";
import {
  isConcreteRefId,
  parseConcreteRefId,
  getRelationsNoReferencedBy,
  shortID,
  splitID,
  itemPassesFilters,
} from "./connections";
import {
  getVersionedDisplayText,
  getNodeFromID,
  ViewPath,
  getParentView,
  getLast,
  getRelationForView,
  getRelationsForContext,
} from "./ViewContext";
import { getPane } from "./planner";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { referenceToText } from "./components/referenceDisplay";

function resolveNodeLabel(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeId: ID,
  context: List<ID>
): string {
  const versionedText = getVersionedDisplayText(
    knowledgeDBs,
    myself,
    nodeId,
    context
  );
  if (versionedText) {
    return versionedText;
  }
  const node = getNodeFromID(knowledgeDBs, nodeId, myself);
  return node?.text || "Loading...";
}

function resolveContextLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  context: List<ID>
): string[] {
  return context
    .map((nodeId, index) =>
      resolveNodeLabel(knowledgeDBs, myself, nodeId, context.slice(0, index))
    )
    .toArray();
}

export type ParsedRef = {
  relation: Relations;
  relationContext: List<ID>;
  targetNode?: ID;
  sourceItem?: RelationItem;
};

export function parseRef(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ParsedRef | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  const parsed = parseConcreteRefId(refId);
  if (!parsed) return undefined;
  const { relationID, targetNode } = parsed;
  const relation = getRelationsNoReferencedBy(knowledgeDBs, relationID, myself);
  if (!relation) return undefined;

  const relationContext = relation.context.map((id) => shortID(id) as ID);
  const sourceItem = targetNode
    ? relation.items.find((item) => shortID(item.nodeID) === targetNode)
    : undefined;

  return { relation, relationContext, targetNode, sourceItem };
}

function resolveLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  relation: Relations,
  relationContext: List<ID>,
  targetNode?: ID
): { contextLabels: string[]; targetLabel: string; fullContext: List<ID> } {
  if (!targetNode) {
    const contextLabels = resolveContextLabels(
      knowledgeDBs,
      myself,
      relationContext
    );
    const targetLabel = resolveNodeLabel(
      knowledgeDBs,
      myself,
      relation.head as ID,
      relationContext
    );
    return { contextLabels, targetLabel, fullContext: relationContext };
  }
  const fullContext = relationContext.push(relation.head as ID);
  const contextLabels = resolveContextLabels(knowledgeDBs, myself, fullContext);
  const targetLabel = resolveNodeLabel(
    knowledgeDBs,
    myself,
    targetNode,
    fullContext
  );
  return { contextLabels, targetLabel, fullContext };
}


function buildDeletedReference(
  refId: LongID,
  myself: PublicKey,
  linkText?: string
): ReferenceNode | undefined {
  const parsed = parseConcreteRefId(refId);
  if (!parsed) return undefined;
  const { relationID, targetNode } = parsed;
  const [remote] = splitID(relationID);
  const author = remote || myself;

  if (!linkText) return undefined;

  const parts = linkText.split(" / ");
  const targetLabel = parts[parts.length - 1];
  const contextLabels = parts.slice(0, -1);
  return {
    id: refId,
    type: "reference",
    text: `(deleted) ${linkText}`,
    targetNode: targetNode || ("" as ID),
    targetContext: List<ID>(),
    contextLabels,
    targetLabel,
    author,
    deleted: true,
  };
}

export function buildOutgoingReference(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ReferenceNode | undefined {
  const ref = parseRef(refId, knowledgeDBs, myself);
  if (!ref) return buildDeletedReference(refId, myself);

  const target = ref.targetNode || (ref.relation.head as ID);
  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    myself,
    ref.relation,
    ref.relationContext,
    ref.targetNode
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} / ${targetLabel}` : targetLabel;

  return {
    id: refId,
    type: "reference",
    text,
    targetNode: target,
    targetContext: fullContext,
    contextLabels,
    targetLabel,
    author: ref.relation.author,
  };
}

function effectiveIDs(
  relation: Relations,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "occurrence"
    | "contains"
  )[]
): List<string> {
  return relation.items
    .filter(
      (item) =>
        itemPassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) => shortID(item.nodeID))
    .toList();
}

export function computeRelationDiff(
  versionRelation: Relations,
  parentRelation: Relations | undefined,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "occurrence"
    | "contains"
  )[]
): { addCount: number; removeCount: number } {
  const versionIDs = effectiveIDs(versionRelation, activeFilters).toSet();
  const parentIDs = parentRelation
    ? effectiveIDs(parentRelation, activeFilters).toSet()
    : List<string>().toSet();
  return {
    addCount: versionIDs.filter((id) => !parentIDs.has(id)).size,
    removeCount: parentIDs.filter((id) => !versionIDs.has(id)).size,
  };
}

function computeVersionMeta(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): VersionMeta {
  const refId = getLast(viewPath).nodeID;
  const parsed = parseConcreteRefId(refId);
  if (!parsed) return { updated: 0, addCount: 0, removeCount: 0 };

  const relation = getRelationsNoReferencedBy(
    data.knowledgeDBs,
    parsed.relationID,
    data.user.publicKey
  );
  if (!relation) return { updated: 0, addCount: 0, removeCount: 0 };

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const parentPath = getParentView(viewPath);
  const parentRelation = parentPath
    ? getRelationForView(data, parentPath, stack)
    : undefined;

  const { addCount, removeCount } = computeRelationDiff(
    relation,
    parentRelation,
    activeFilters
  );
  return { updated: relation.updated, addCount, removeCount };
}

function findCrefToNode(
  items: List<RelationItem>,
  targetRelation: Relations,
  containingRelation: Relations | undefined
): RelationItem | undefined {
  return items.find((item) => {
    if (!isConcreteRefId(item.nodeID)) return false;
    const parsed = parseConcreteRefId(item.nodeID);
    if (!parsed) return false;
    const matchesHead = parsed.relationID === targetRelation.id;
    const matchesItem =
      !!containingRelation &&
      parsed.targetNode === shortID(targetRelation.head) &&
      parsed.relationID === containingRelation.id;
    return matchesHead || matchesItem;
  });
}

function findIncomingCrefItem(
  ref: ParsedRef,
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): RelationItem | undefined {
  const parentPath = getParentView(viewPath);
  if (!parentPath) return undefined;
  const parentRelation = getRelationForView(data, parentPath, stack);
  if (!parentRelation) return undefined;
  const grandParentPath = getParentView(parentPath);
  const containingRelation = grandParentPath
    ? getRelationForView(data, grandParentPath, stack)
    : undefined;
  const fromSource = findCrefToNode(
    ref.relation.items,
    parentRelation,
    containingRelation
  );
  if (fromSource) return fromSource;
  const targetNodeRelation = ref.targetNode
    ? getRelationsForContext(
        data.knowledgeDBs,
        data.user.publicKey,
        ref.targetNode,
        ref.relationContext.push(shortID(ref.relation.head) as ID),
        undefined,
        false
      )
    : undefined;
  return targetNodeRelation
    ? findCrefToNode(
        targetNodeRelation.items,
        parentRelation,
        containingRelation
      )
    : undefined;
}

export function buildReferenceItem(
  refId: LongID,
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): ReferenceNode | undefined {
  const ref = parseRef(refId, data.knowledgeDBs, data.user.publicKey);
  if (!ref) {
    const parentPath = getParentView(viewPath);
    const parentRelation = parentPath
      ? getRelationForView(data, parentPath, stack)
      : undefined;
    const parentItem = parentRelation?.items.find(
      (item) => item.nodeID === refId
    );
    return buildDeletedReference(
      refId,
      data.user.publicKey,
      parentItem?.linkText
    );
  }

  if (virtualType === "suggestion") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    return { ...outgoing, text: outgoing.targetLabel };
  }

  if (virtualType === "incoming" || virtualType === "occurrence") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    const displayAs = virtualType as "incoming" | "occurrence";
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(ref, data, viewPath, stack)
        : undefined;
    const incomingRelevance = crefItem?.relevance ?? ref.sourceItem?.relevance;
    const incomingArgument = crefItem?.argument ?? ref.sourceItem?.argument;
    const text = referenceToText({
      displayAs,
      contextLabels: outgoing.contextLabels,
      targetLabel: outgoing.targetLabel,
      incomingRelevance,
      incomingArgument,
    });
    return {
      ...outgoing,
      text,
      displayAs,
      incomingRelevance,
      incomingArgument,
    };
  }

  if (virtualType === "version") {
    const versionMeta = computeVersionMeta(data, viewPath, stack);
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    const isOtherUser = outgoing.author !== data.user.publicKey;
    const dateStr = new Date(versionMeta.updated).toLocaleString();
    const parts = [
      dateStr,
      ...(isOtherUser ? ["\u{1F464}"] : []),
      ...(versionMeta.addCount > 0 ? [`+${versionMeta.addCount}`] : []),
      ...(versionMeta.removeCount > 0 ? [`-${versionMeta.removeCount}`] : []),
    ];
    const text = parts.join(" ");
    return { ...outgoing, text, versionMeta };
  }

  const outgoing = buildOutgoingReference(
    refId,
    data.knowledgeDBs,
    data.user.publicKey
  );
  if (!outgoing || !ref) return outgoing;

  const parentPath = getParentView(viewPath);
  if (!parentPath) return outgoing;

  const parentRelation = getRelationForView(data, parentPath, stack);
  if (
    parentRelation &&
    ref.relation.head === parentRelation.head &&
    ref.relation.context.equals(parentRelation.context)
  ) {
    const versionMeta = computeVersionMeta(data, viewPath, stack);
    return { ...outgoing, text: outgoing.text, versionMeta };
  }

  if (!parentRelation) return outgoing;

  const storedItem = parentRelation.items.find((item) => item.nodeID === refId);
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const grandParentPath = getParentView(parentPath);
  const containingRelation = grandParentPath
    ? getRelationForView(data, grandParentPath, stack)
    : undefined;

  const targetNodeRelation = ref.targetNode
    ? getRelationsForContext(
        data.knowledgeDBs,
        data.user.publicKey,
        ref.targetNode,
        ref.relationContext.push(shortID(ref.relation.head) as ID),
        undefined,
        false
      )
    : undefined;

  const findReverseCref = (
    items: List<RelationItem>
  ): RelationItem | undefined =>
    findCrefToNode(items, parentRelation, containingRelation);

  const incomingCref =
    findReverseCref(ref.relation.items) ||
    (targetNodeRelation
      ? findReverseCref(targetNodeRelation.items)
      : undefined);
  const hasActiveIncoming =
    !!incomingCref && incomingCref.relevance !== "not_relevant";

  const isOccurrenceOrigin = !!ref.targetNode && !!ref.sourceItem;
  const resolveDisplayAs = ():
    | "bidirectional"
    | "incoming"
    | "occurrence"
    | undefined => {
    if (hasActiveIncoming) return isNotRelevant ? "incoming" : "bidirectional";
    if (isOccurrenceOrigin) return "occurrence";
    return undefined;
  };
  const displayAs = resolveDisplayAs();

  if (!displayAs) return outgoing;

  const incomingRel =
    displayAs === "occurrence"
      ? ref.sourceItem!.relevance
      : incomingCref!.relevance;
  const incomingArg =
    displayAs === "occurrence"
      ? ref.sourceItem!.argument
      : incomingCref!.argument;
  const text = referenceToText({
    displayAs,
    contextLabels: outgoing.contextLabels,
    targetLabel: outgoing.targetLabel,
    incomingRelevance: incomingRel,
    incomingArgument: incomingArg,
  });
  return {
    ...outgoing,
    text,
    displayAs,
    incomingRelevance: incomingRel,
    incomingArgument: incomingArg,
  };
}
