import { List, Map } from "immutable";
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
} from "./ViewContext";
import { getPane } from "./planner";
import { DEFAULT_TYPE_FILTERS } from "./constants";

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

function relevanceIndicator(relevance: Relevance): string {
  if (relevance === "relevant") return "!";
  if (relevance === "maybe_relevant") return "?";
  if (relevance === "little_relevant") return "~";
  return "";
}

function argumentIndicator(argument: Argument | undefined): string {
  if (argument === "confirms") return "+";
  if (argument === "contra") return "-";
  return "";
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
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ReferenceNode | undefined {
  const parsed = parseConcreteRefId(refId);
  if (!parsed) return undefined;
  const { relationID } = parsed;
  const [remote] = splitID(relationID);
  const author = remote || myself;
  const db = knowledgeDBs.get(author);
  const tombstones = db?.tombstones || Map<ID, ID>();
  const shortRelID = splitID(relationID)[1];
  const headNodeID = tombstones.get(shortRelID as ID);
  if (!headNodeID) return undefined;
  const headNode = getNodeFromID(knowledgeDBs, headNodeID, myself);
  const targetLabel = headNode?.text || "(deleted)";
  return {
    id: refId,
    type: "reference",
    text: `(deleted) ${targetLabel}`,
    targetNode: headNodeID,
    targetContext: List<ID>(),
    contextLabels: [],
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
  if (!ref) return buildDeletedReference(refId, knowledgeDBs, myself);

  const target = ref.targetNode || (ref.relation.head as ID);
  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    myself,
    ref.relation,
    ref.relationContext,
    ref.targetNode
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} >>> ${targetLabel}` : targetLabel;

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

export function buildReferenceItem(
  refId: LongID,
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): ReferenceNode | undefined {
  const ref = parseRef(refId, data.knowledgeDBs, data.user.publicKey);
  if (!ref) {
    return buildDeletedReference(refId, data.knowledgeDBs, data.user.publicKey);
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

  if (virtualType === "incoming") {
    const target = ref.targetNode || (ref.relation.head as ID);
    const { contextLabels, targetLabel, fullContext } = resolveLabels(
      data.knowledgeDBs,
      data.user.publicKey,
      ref.relation,
      ref.relationContext,
      ref.targetNode
    );
    const indicator =
      relevanceIndicator(ref.sourceItem?.relevance) +
      argumentIndicator(ref.sourceItem?.argument);
    const suffix = indicator ? ` ${indicator}` : "";
    const reversed = [...contextLabels].reverse().join(" / ");
    const text = reversed
      ? `${targetLabel}${suffix} <<< ${reversed}`
      : targetLabel;
    return {
      id: refId,
      type: "reference",
      text,
      targetNode: target,
      targetContext: fullContext,
      contextLabels,
      targetLabel,
      author: ref.relation.author,
      incomingRelevance: ref.sourceItem?.relevance,
      incomingArgument: ref.sourceItem?.argument,
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

  const parentNodeID = getLast(parentPath).nodeID;
  const parentShortID = shortID(parentNodeID);
  const targetRelationHasParent = ref.relation.items.some(
    (item) => shortID(item.nodeID) === parentShortID
  );

  if (!targetRelationHasParent) return outgoing;

  const incomingItem = ref.relation.items.find(
    (item) => shortID(item.nodeID) === parentShortID
  );
  const indicator =
    relevanceIndicator(incomingItem?.relevance) +
    argumentIndicator(incomingItem?.argument);
  const suffix = indicator ? ` ${indicator}` : "";
  const contextPath = outgoing.contextLabels.join(" / ");
  const arrows = suffix ? `<<< >>>${suffix}` : "<<< >>>";
  const text = contextPath
    ? `${contextPath} ${arrows} ${outgoing.targetLabel}`
    : outgoing.targetLabel;

  return {
    ...outgoing,
    text,
    isBidirectional: true,
    incomingRelevance: incomingItem?.relevance,
    incomingArgument: incomingItem?.argument,
  };
}
