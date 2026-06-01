/* eslint-disable functional/immutable-data */

export type NodeLookupScope =
  | { type: "local" }
  | { type: "source"; sourceId: SourceId };

export type SourceNodeCandidate = {
  sourceId: SourceId;
  node: GraphNode;
};

export type NodeLookupIndexes = {
  localSourceId: SourceId;
  localNodesById: globalThis.Map<ID, GraphNode>;
  sourceCandidatesById: globalThis.Map<ID, SourceNodeCandidate[]>;
};

export type NodeResolution = {
  node: GraphNode;
  scope: NodeLookupScope;
  candidate?: SourceNodeCandidate;
  candidates: SourceNodeCandidate[];
  ambiguous: boolean;
};

function sourcePriority(
  sourceOrder: readonly SourceId[],
  sourceId: SourceId
): number {
  const index = sourceOrder.indexOf(sourceId);
  return index >= 0 ? index : sourceOrder.length;
}

function sortCandidates(
  candidates: SourceNodeCandidate[],
  sourceOrder: readonly SourceId[]
): SourceNodeCandidate[] {
  return candidates.slice().sort((left, right) => {
    const leftPriority = sourcePriority(sourceOrder, left.sourceId);
    const rightPriority = sourcePriority(sourceOrder, right.sourceId);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const sourceCompare = left.sourceId.localeCompare(right.sourceId);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }
    return right.node.updated - left.node.updated;
  });
}

export function buildNodeLookupIndexes(
  knowledgeDBs: KnowledgeDBs,
  localSourceId: SourceId,
  sourceOrder: readonly SourceId[] = []
): NodeLookupIndexes {
  const localNodesById = new globalThis.Map<ID, GraphNode>();
  const sourceCandidatesById = new globalThis.Map<ID, SourceNodeCandidate[]>();

  knowledgeDBs.forEach((db, sourceId) => {
    db.nodes.valueSeq().forEach((node) => {
      const id = node.id as ID;
      if (sourceId === localSourceId) {
        localNodesById.set(id, node);
        return;
      }
      const candidate: SourceNodeCandidate = { sourceId, node };
      const existing = sourceCandidatesById.get(id);
      if (existing) {
        existing.push(candidate);
        return;
      }
      sourceCandidatesById.set(id, [candidate]);
    });
  });

  sourceCandidatesById.forEach((candidates, id) => {
    sourceCandidatesById.set(id, sortCandidates(candidates, sourceOrder));
  });

  return {
    localSourceId,
    localNodesById,
    sourceCandidatesById,
  };
}

export function resolveNodeReferenceFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  id: ID,
  scope: NodeLookupScope,
  localSourceId: SourceId,
  sourceOrder: readonly SourceId[] = []
): NodeResolution | undefined {
  if (scope.type === "local") {
    const localNode = knowledgeDBs
      .get(localSourceId as PublicKey)
      ?.nodes.get(id);
    if (localNode) {
      return {
        node: localNode,
        scope,
        candidates: [],
        ambiguous: false,
      };
    }

    const candidates = sortCandidates(
      knowledgeDBs
        .entrySeq()
        .filter(([sourceId]) => sourceId !== localSourceId)
        .map(([sourceId, db]) => {
          const node = db.nodes.get(id);
          return node
            ? ({ sourceId: sourceId as SourceId, node } as SourceNodeCandidate)
            : undefined;
        })
        .filter((candidate): candidate is SourceNodeCandidate => !!candidate)
        .toArray(),
      sourceOrder
    );
    const candidate = candidates[0];
    return candidate
      ? {
          node: candidate.node,
          scope: { type: "source", sourceId: candidate.sourceId },
          candidate,
          candidates,
          ambiguous: candidates.length > 1,
        }
      : undefined;
  }

  const sourceNode = knowledgeDBs
    .get(scope.sourceId as PublicKey)
    ?.nodes.get(id);
  return sourceNode
    ? {
        node: sourceNode,
        scope,
        candidate: { sourceId: scope.sourceId, node: sourceNode },
        candidates:
          scope.sourceId === localSourceId
            ? []
            : [{ sourceId: scope.sourceId, node: sourceNode }],
        ambiguous: false,
      }
    : undefined;
}

export function resolveNodeReference(
  indexes: NodeLookupIndexes,
  id: ID,
  scope: NodeLookupScope
): NodeResolution | undefined {
  if (scope.type === "local") {
    const localNode = indexes.localNodesById.get(id);
    if (localNode) {
      return {
        node: localNode,
        scope,
        candidates: [],
        ambiguous: false,
      };
    }

    const candidates = indexes.sourceCandidatesById.get(id) ?? [];
    const candidate = candidates[0];
    return candidate
      ? {
          node: candidate.node,
          scope: { type: "source", sourceId: candidate.sourceId },
          candidate,
          candidates,
          ambiguous: candidates.length > 1,
        }
      : undefined;
  }

  if (scope.sourceId === indexes.localSourceId) {
    const localNode = indexes.localNodesById.get(id);
    return localNode
      ? {
          node: localNode,
          scope,
          candidates: [],
          ambiguous: false,
        }
      : undefined;
  }

  const candidate = (indexes.sourceCandidatesById.get(id) ?? []).find(
    (entry) => entry.sourceId === scope.sourceId
  );
  return candidate
    ? {
        node: candidate.node,
        scope,
        candidate,
        candidates: [candidate],
        ambiguous: false,
      }
    : undefined;
}
