import { Map as ImmutableMap } from "immutable";
import { isConcreteRefId, parseConcreteRefId } from "./connections";

export function createEmptySemanticIndex(): SemanticIndex {
  return {
    relationByID: new globalThis.Map<LongID, Relations>(),
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
  relation: Relations
): void {
  addToSetMap(semanticIndex.semantic, relation.textHash, relation.id);

  relation.items.forEach((item) => {
    if (item.relevance === "not_relevant") {
      return;
    }
    if (isConcreteRefId(item.id)) {
      const parsed = parseConcreteRefId(item.id);
      if (parsed) {
        addToIncomingMap(
          semanticIndex.incomingCrefs,
          parsed.relationID,
          relation.id
        );
      }
    }
  });
}

function removeRelationSemanticEntries(
  semanticIndex: SemanticIndex,
  relation: Relations
): void {
  removeFromSetMap(semanticIndex.semantic, relation.textHash, relation.id);

  relation.items.forEach((item) => {
    if (item.relevance === "not_relevant") {
      return;
    }
    if (isConcreteRefId(item.id)) {
      const parsed = parseConcreteRefId(item.id);
      if (parsed) {
        removeFromIncomingMap(
          semanticIndex.incomingCrefs,
          parsed.relationID,
          relation.id
        );
      }
    }
  });
}

export function addRelationsToSemanticIndex(
  semanticIndex: SemanticIndex,
  relations: ImmutableMap<string, Relations>
): SemanticIndex {
  if (relations.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    relationByID: new globalThis.Map<LongID, Relations>(
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

  relations.valueSeq().forEach((relation) => {
    nextIndex.relationByID.set(relation.id, relation);
  });

  relations.valueSeq().forEach((relation) => {
    addRelationSemanticEntries(nextIndex, relation);
  });
  return nextIndex;
}

export function removeRelationsFromSemanticIndex(
  semanticIndex: SemanticIndex,
  relations: ImmutableMap<string, Relations>
): SemanticIndex {
  if (relations.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    relationByID: new globalThis.Map<LongID, Relations>(
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

  relations.valueSeq().forEach((relation) => {
    removeRelationSemanticEntries(nextIndex, relation);
  });
  relations.valueSeq().forEach((relation) => {
    nextIndex.relationByID.delete(relation.id);
  });
  return nextIndex;
}

export function buildSemanticIndexFromDocuments(
  relationsByDocumentKey: ImmutableMap<string, ImmutableMap<string, Relations>>
): SemanticIndex {
  return relationsByDocumentKey
    .valueSeq()
    .reduce(
      (acc, relations) => addRelationsToSemanticIndex(acc, relations),
      createEmptySemanticIndex()
    );
}
