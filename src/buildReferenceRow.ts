import { List } from "immutable";
import {
  isConcreteRefId,
  parseConcreteRefId,
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
  shortID,
  splitID,
  itemPassesFilters,
  getRelationItemSemanticID,
  getRelationContext,
  getRelationSemanticID,
} from "./connections";
import {
  getTextHashForSemanticID,
  getTextForSemanticID,
} from "./semanticProjection";
import {
  ViewPath,
  getParentView,
  getLast,
  getRelationForView,
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
  relation: Relations;
  relationContext: List<ID>;
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
  const { relationID } = parsed;
  const relation = getRelationsNoReferencedBy(knowledgeDBs, relationID, myself);
  if (!relation) return undefined;

  const relationContext = getRelationContext(knowledgeDBs, relation).map(
    (id) => shortID(id) as ID
  );
  const sourceItem = relation.parent
    ? getRelationsNoReferencedBy(
        knowledgeDBs,
        relation.parent,
        relation.author
      )?.items.find((item) => item.id === relation.id)
    : undefined;

  return { relation, relationContext, sourceItem };
}

function resolveLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  relation: Relations,
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
    getRelationSemanticID(relation)
  );
  return { contextLabels, targetLabel, fullContext: relationContext };
}

function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  author: PublicKey
): string {
  return (
    getTextHashForSemanticID(knowledgeDBs, semanticID, author) ||
    shortID(semanticID as ID)
  );
}

function relationsMatchForVersion(
  knowledgeDBs: KnowledgeDBs,
  left: Relations,
  right: Relations
): boolean {
  const useExactMatch =
    left.author === right.author && left.root === right.root;
  if (useExactMatch) {
    return (
      getRelationSemanticID(left) === getRelationSemanticID(right) &&
      getRelationContext(knowledgeDBs, left).equals(
        getRelationContext(knowledgeDBs, right)
      )
    );
  }

  const leftContext = getRelationContext(knowledgeDBs, left);
  const rightContext = getRelationContext(knowledgeDBs, right);
  return (
    getSemanticNodeKey(
      knowledgeDBs,
      getRelationSemanticID(left),
      left.author
    ) ===
      getSemanticNodeKey(
        knowledgeDBs,
        getRelationSemanticID(right),
        right.author
      ) &&
    leftContext.size === rightContext.size &&
    leftContext.every(
      (semanticID, index) =>
        getSemanticNodeKey(knowledgeDBs, semanticID, left.author) ===
        getSemanticNodeKey(
          knowledgeDBs,
          rightContext.get(index) as ID,
          right.author
        )
    )
  );
}

function buildDeletedReference(
  refId: LongID,
  myself: PublicKey,
  linkText?: string
): ReferenceRow | undefined {
  const parsed = parseConcreteRefId(refId);
  if (!parsed) return undefined;
  const { relationID } = parsed;
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
    .map((item) =>
      getSemanticNodeKey(
        knowledgeDBs,
        getRelationItemSemanticID(knowledgeDBs, item, relation.author),
        relation.author
      )
    )
    .toList();
}

export function computeRelationDiff(
  knowledgeDBs: KnowledgeDBs,
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
    data.knowledgeDBs,
    relation,
    parentRelation,
    activeFilters
  );
  return { updated: relation.updated, addCount, removeCount };
}

function findCrefToNode(
  items: List<RelationItem>,
  targetRelation: Relations,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): RelationItem | undefined {
  return items.find((item) => {
    if (!isConcreteRefId(item.id)) return false;
    const resolvedTarget = getConcreteRefTargetRelation(
      knowledgeDBs,
      item.id,
      myself
    );
    return resolvedTarget?.id === targetRelation.id;
  });
}

function getReferenceSourceRelations(
  ref: ParsedRef,
  knowledgeDBs: KnowledgeDBs
): Relations[] {
  const parentRelation = ref.relation.parent
    ? getRelationsNoReferencedBy(
        knowledgeDBs,
        ref.relation.parent,
        ref.relation.author
      )
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
): RelationItem | undefined {
  const parentPath = getParentView(viewPath);
  if (!parentPath) return undefined;
  const parentRelation = getRelationForView(data, parentPath, stack);
  if (!parentRelation) return undefined;
  return getReferenceSourceRelations(ref, data.knowledgeDBs)
    .map((sourceRelation) =>
      findCrefToNode(
        sourceRelation.items,
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
      ? getRelationForView(data, parentPath, stack)
      : undefined;
    const parentItem = parentRelation?.items.find((item) => item.id === refId);
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
    relationsMatchForVersion(data.knowledgeDBs, ref.relation, parentRelation)
  ) {
    const versionMeta = computeVersionMeta(data, viewPath, stack);
    return { ...outgoing, text: outgoing.text, versionMeta };
  }
  if (!parentRelation) return outgoing;

  const storedItem = parentRelation.items.find((item) => item.id === refId);
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const findReverseCref = (
    items: List<RelationItem>
  ): RelationItem | undefined =>
    findCrefToNode(
      items,
      parentRelation,
      data.knowledgeDBs,
      data.user.publicKey
    );

  const incomingCref = getReferenceSourceRelations(ref, data.knowledgeDBs)
    .map((sourceRelation) => findReverseCref(sourceRelation.items))
    .find((item) => item !== undefined);
  const hasActiveIncoming =
    !!incomingCref && incomingCref.relevance !== "not_relevant";

  const isOccurrenceOrigin = false;
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
