import { List } from "immutable";
import {
  getChildNodes,
  getNode,
  resolveNode,
  isRefNode,
  shortID,
  splitID,
  itemPassesFilters,
  getSemanticID,
  getNodeContext,
} from "./connections";
import { getTextForSemanticID } from "./semanticProjection";
import {
  ViewPath,
  getParentView,
  getLast,
  getNodeForView,
} from "./ViewContext";
import { getPane } from "./planner";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { referenceToText } from "./components/referenceDisplay";

function argumentPrefix(argument?: Argument): string {
  if (argument === "confirms") {
    return "+";
  }
  if (argument === "contra") {
    return "-";
  }
  return "";
}

function resolveNodeLabel(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeId: ID
): string {
  return getTextForSemanticID(knowledgeDBs, nodeId, myself) || "Loading...";
}

function resolveContextLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  context: List<ID>
): string[] {
  return context
    .map((nodeId) => resolveNodeLabel(knowledgeDBs, myself, nodeId))
    .toArray();
}

export type ParsedRef = {
  relation: GraphNode;
  relationContext: List<ID>;
  sourceItem?: GraphNode;
};

export function parseRef(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ParsedRef | undefined {
  const sourceItem = getNode(knowledgeDBs, refId, myself);
  const relation = resolveNode(knowledgeDBs, sourceItem);
  if (!relation) {
    return undefined;
  }

  const relationContext = getNodeContext(knowledgeDBs, relation).map(
    (id) => shortID(id) as ID
  );

  return { relation, relationContext, sourceItem: sourceItem || relation };
}

function resolveLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  relation: GraphNode,
  relationContext: List<ID>
): { contextLabels: string[]; targetLabel: string; fullContext: List<ID> } {
  const contextLabels = resolveContextLabels(
    knowledgeDBs,
    myself,
    relationContext
  );
  const targetLabel = resolveNodeLabel(
    knowledgeDBs,
    myself,
    getSemanticID(knowledgeDBs, relation)
  );
  return { contextLabels, targetLabel, fullContext: relationContext };
}

function relationsMatchForVersion(
  knowledgeDBs: KnowledgeDBs,
  left: GraphNode,
  right: GraphNode
): boolean {
  return (
    getSemanticID(knowledgeDBs, left) === getSemanticID(knowledgeDBs, right) &&
    getNodeContext(knowledgeDBs, left).equals(
      getNodeContext(knowledgeDBs, right)
    )
  );
}

function buildDeletedReference(
  refId: LongID,
  myself: PublicKey,
  linkText?: string
): ReferenceRow | undefined {
  const [remote] = splitID(refId);
  const author = remote || myself;

  if (!linkText) return undefined;

  const parts = linkText.split(" / ");
  const targetLabel = parts[parts.length - 1];
  const contextLabels = parts.slice(0, -1);
  return {
    id: refId,
    type: "reference",
    text: `(deleted) ${linkText}`,
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
): ReferenceRow | undefined {
  const ref = parseRef(refId, knowledgeDBs, myself);
  if (!ref) return buildDeletedReference(refId, myself);

  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    myself,
    ref.relation,
    ref.relationContext
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} / ${targetLabel}` : targetLabel;

  return {
    id: refId,
    type: "reference",
    text,
    targetContext: fullContext,
    contextLabels,
    targetLabel,
    author: ref.relation.author,
  };
}

function effectiveIDs(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): List<string> {
  return getChildNodes(knowledgeDBs, relation, relation.author)
    .filter(
      (item) =>
        itemPassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) => getSemanticID(knowledgeDBs, item))
    .toList();
}

export function computeRelationDiff(
  knowledgeDBs: KnowledgeDBs,
  versionRelation: GraphNode,
  parentRelation: GraphNode | undefined,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): { addCount: number; removeCount: number } {
  const versionIDs = effectiveIDs(
    knowledgeDBs,
    versionRelation,
    activeFilters
  ).toSet();
  const parentIDs = parentRelation
    ? effectiveIDs(knowledgeDBs, parentRelation, activeFilters).toSet()
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
  const refId = getLast(viewPath);
  const relation = resolveNode(
    data.knowledgeDBs,
    getNode(data.knowledgeDBs, refId, data.user.publicKey)
  );
  if (!relation) return { updated: 0, addCount: 0, removeCount: 0 };

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const parentPath = getParentView(viewPath);
  const parentRelation = parentPath
    ? getNodeForView(data, parentPath, stack)
    : undefined;

  const { addCount, removeCount } = computeRelationDiff(
    data.knowledgeDBs,
    relation,
    parentRelation,
    activeFilters
  );
  return { updated: relation.updated, addCount, removeCount };
}

function findCrefToNode(
  children: List<ID>,
  targetRelation: GraphNode,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): GraphNode | undefined {
  return children
    .map((childID) => getNode(knowledgeDBs, childID, myself))
    .find((item) => {
      if (!isRefNode(item)) return false;
      const resolvedTarget = resolveNode(knowledgeDBs, item);
      return resolvedTarget?.id === targetRelation.id;
    });
}

function getReferenceSourceRelations(
  ref: ParsedRef,
  knowledgeDBs: KnowledgeDBs
): GraphNode[] {
  const parentRelation = ref.relation.parent
    ? getNode(knowledgeDBs, ref.relation.parent, ref.relation.author)
    : undefined;
  return parentRelation && parentRelation.id !== ref.relation.id
    ? [ref.relation, parentRelation]
    : [ref.relation];
}

function findIncomingCrefItem(
  ref: ParsedRef,
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): GraphNode | undefined {
  const parentPath = getParentView(viewPath);
  if (!parentPath) return undefined;
  const parentRelation = getNodeForView(data, parentPath, stack);
  if (!parentRelation) return undefined;
  return getReferenceSourceRelations(ref, data.knowledgeDBs)
    .map((sourceRelation) =>
      findCrefToNode(
        sourceRelation.children,
        parentRelation,
        data.knowledgeDBs,
        data.user.publicKey
      )
    )
    .find((item) => item !== undefined);
}

export function buildReferenceItem(
  refId: LongID,
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): ReferenceRow | undefined {
  const ref = parseRef(refId, data.knowledgeDBs, data.user.publicKey);
  if (!ref) {
    const parentPath = getParentView(viewPath);
    const parentRelation = parentPath
      ? getNodeForView(data, parentPath, stack)
      : undefined;
    const parentItem = parentRelation
      ? getNode(data.knowledgeDBs, refId, data.user.publicKey)
      : undefined;
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

  if (virtualType === "incoming") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(ref, data, viewPath, stack)
        : undefined;
    const incomingRelevance = crefItem?.relevance ?? ref.sourceItem?.relevance;
    const incomingArgument = crefItem?.argument ?? ref.sourceItem?.argument;
    const text = referenceToText({
      displayAs: "incoming",
      contextLabels: outgoing.contextLabels,
      targetLabel: outgoing.targetLabel,
      incomingRelevance,
      incomingArgument,
    });
    return {
      ...outgoing,
      text,
      displayAs: "incoming",
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

  const parentRelation = getNodeForView(data, parentPath, stack);
  if (
    parentRelation &&
    relationsMatchForVersion(data.knowledgeDBs, ref.relation, parentRelation)
  ) {
    const versionMeta = computeVersionMeta(data, viewPath, stack);
    return { ...outgoing, text: outgoing.text, versionMeta };
  }
  if (!parentRelation) return outgoing;

  const storedItem = getNode(data.knowledgeDBs, refId, data.user.publicKey);
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const findReverseCref = (children: List<ID>): GraphNode | undefined =>
    findCrefToNode(
      children,
      parentRelation,
      data.knowledgeDBs,
      data.user.publicKey
    );

  const incomingCref = getReferenceSourceRelations(ref, data.knowledgeDBs)
    .map((sourceRelation) => findReverseCref(sourceRelation.children))
    .find((item) => item !== undefined);
  const hasActiveIncoming =
    !!incomingCref && incomingCref.relevance !== "not_relevant";

  const displayAs = (() => {
    if (!hasActiveIncoming) return undefined;
    return isNotRelevant ? "incoming" : "bidirectional";
  })();

  if (!displayAs) {
    const argument = argumentPrefix(
      storedItem?.argument ?? ref.sourceItem?.argument
    );
    if (!argument) {
      return outgoing;
    }
    const targetLabel = `${argument} ${outgoing.targetLabel}`;
    return {
      ...outgoing,
      targetLabel,
      text: referenceToText({
        contextLabels: outgoing.contextLabels,
        targetLabel,
      }),
    };
  }

  const incomingRel = incomingCref!.relevance;
  const incomingArg = incomingCref!.argument;
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
