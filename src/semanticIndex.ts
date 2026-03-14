import { Map as ImmutableMap } from "immutable";
import { EMPTY_SEMANTIC_ID, getRefTargetID, isRefNode } from "./connections";

export function createEmptySemanticIndex(): SemanticIndex {
  return {
    relationByID: new globalThis.Map<LongID, GraphNode>(),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(),
  };
}

function addToSetMap(
  map: globalThis.Map<string, globalThis.Set<LongID>>,
  key: string,
  value: LongID
): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new globalThis.Set<LongID>([value]));
}

function addToIncomingMap(
  map: globalThis.Map<LongID, globalThis.Set<LongID>>,
  targetRelationID: LongID,
  sourceRelationID: LongID
): void {
  const existing = map.get(targetRelationID);
  if (existing) {
    existing.add(sourceRelationID);
    return;
  }
  map.set(targetRelationID, new globalThis.Set<LongID>([sourceRelationID]));
}

function removeFromSetMap(
  map: globalThis.Map<string, globalThis.Set<LongID>>,
  key: string,
  value: LongID
): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }
  existing.delete(value);
  if (existing.size === 0) {
    map.delete(key);
  }
}

function removeFromIncomingMap(
  map: globalThis.Map<LongID, globalThis.Set<LongID>>,
  targetRelationID: LongID,
  sourceRelationID: LongID
): void {
  const existing = map.get(targetRelationID);
  if (!existing) {
    return;
  }
  existing.delete(sourceRelationID);
  if (existing.size === 0) {
    map.delete(targetRelationID);
  }
}

function addRelationSemanticEntries(
  semanticIndex: SemanticIndex,
  relation: GraphNode
): void {
  addToSetMap(semanticIndex.semantic, relation.text, relation.id);

  relation.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childRelation = semanticIndex.relationByID.get(childID as LongID);
    if (!childRelation || childRelation.relevance === "not_relevant") {
      return;
    }
    const targetRelationID = isRefNode(childRelation)
      ? getRefTargetID(childRelation)
      : undefined;
    if (targetRelationID) {
      addToIncomingMap(
        semanticIndex.incomingCrefs,
        targetRelationID,
        relation.id
      );
    }
  });
}

function removeRelationSemanticEntries(
  semanticIndex: SemanticIndex,
  relation: GraphNode
): void {
  removeFromSetMap(semanticIndex.semantic, relation.text, relation.id);

  relation.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childRelation = semanticIndex.relationByID.get(childID as LongID);
    if (!childRelation || childRelation.relevance === "not_relevant") {
      return;
    }
    const targetRelationID = isRefNode(childRelation)
      ? getRefTargetID(childRelation)
      : undefined;
    if (targetRelationID) {
      removeFromIncomingMap(
        semanticIndex.incomingCrefs,
        targetRelationID,
        relation.id
      );
    }
  });
}

export function addRelationsToSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    relationByID: new globalThis.Map<LongID, GraphNode>(
      semanticIndex.relationByID
    ),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...semanticIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.incomingCrefs.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
  };

  nodes.valueSeq().forEach((relation) => {
    nextIndex.relationByID.set(relation.id, relation);
  });

  nodes.valueSeq().forEach((relation) => {
    addRelationSemanticEntries(nextIndex, relation);
  });
  return nextIndex;
}

export function removeRelationsFromSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    relationByID: new globalThis.Map<LongID, GraphNode>(
      semanticIndex.relationByID
    ),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...semanticIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.incomingCrefs.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
  };

  nodes.valueSeq().forEach((relation) => {
    removeRelationSemanticEntries(nextIndex, relation);
  });
  nodes.valueSeq().forEach((relation) => {
    nextIndex.relationByID.delete(relation.id);
  });
  return nextIndex;
}

export function buildSemanticIndexFromDocuments(
  relationsByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>
): SemanticIndex {
  return relationsByDocumentKey
    .valueSeq()
    .reduce(
      (acc, nodes) => addRelationsToSemanticIndex(acc, nodes),
      createEmptySemanticIndex()
    );
}
