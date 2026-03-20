import { Map as ImmutableMap } from "immutable";
import type {
  GraphNode,
  KnowledgeDBs,
  KnowledgeData,
  PublicKey,
  SemanticIndex,
} from "../graph/public";
import {
  addNodesToSemanticIndex,
  buildSemanticIndexFromDocuments,
  createEmptySemanticIndex,
  removeNodesFromSemanticIndex,
} from "../graph/public";
import type {
  DocumentStoreChange,
  StoredDeleteRecord,
  StoredDocumentRecord,
} from "./indexedDB";
import {
  parseStoredDocumentNodes,
  rebuildDocumentKnowledgeDBs,
} from "./documentMaterialization";

export type DocumentSnapshot = {
  documents: ImmutableMap<string, StoredDocumentRecord>;
  deletes: ImmutableMap<string, StoredDeleteRecord>;
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
};

export function createEmptySnapshot(): DocumentSnapshot {
  return {
    documents: ImmutableMap<string, StoredDocumentRecord>(),
    deletes: ImmutableMap<string, StoredDeleteRecord>(),
    nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>(),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: createEmptySemanticIndex(),
  };
}

export function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  document: StoredDocumentRecord
): DocumentSnapshot {
  const nextNodes = parseStoredDocumentNodes(document);
  const existingDocument = snapshot.documents.get(document.replaceableKey);
  const existingDelete = snapshot.deletes.get(document.replaceableKey);
  const existingNodes =
    snapshot.nodesByDocumentKey.get(document.replaceableKey) ||
    ImmutableMap<string, GraphNode>();

  if (existingDelete && existingDelete.deletedAt >= document.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs >= document.updatedMs) {
    return snapshot;
  }

  const nextDeletes =
    existingDelete && document.updatedMs > existingDelete.deletedAt
      ? snapshot.deletes.remove(document.replaceableKey)
      : snapshot.deletes;
  const withoutExistingNodes =
    existingNodes.size > 0
      ? removeNodesFromSemanticIndex(snapshot.semanticIndex, existingNodes)
      : snapshot.semanticIndex;
  const nextSnapshotBase = {
    ...snapshot,
    documents: snapshot.documents.set(document.replaceableKey, document),
    deletes: nextDeletes,
    nodesByDocumentKey: snapshot.nodesByDocumentKey.set(
      document.replaceableKey,
      nextNodes
    ),
    semanticIndex: addNodesToSemanticIndex(withoutExistingNodes, nextNodes),
  };
  const knowledgeDBs = rebuildDocumentKnowledgeDBs({
    knowledgeDBs: nextSnapshotBase.knowledgeDBs,
    documents: nextSnapshotBase.documents,
    nodesByDocumentKey: nextSnapshotBase.nodesByDocumentKey,
    authors: [document.author],
  });
  return {
    ...nextSnapshotBase,
    knowledgeDBs,
  };
}

export function applyDeleteToSnapshot(
  snapshot: DocumentSnapshot,
  deletion: StoredDeleteRecord
): DocumentSnapshot {
  const existingDocument = snapshot.documents.get(deletion.replaceableKey);
  const existingDelete = snapshot.deletes.get(deletion.replaceableKey);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return snapshot;
  }

  const nextSnapshot = {
    ...snapshot,
    documents:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? snapshot.documents.remove(deletion.replaceableKey)
        : snapshot.documents,
    deletes: snapshot.deletes.set(deletion.replaceableKey, deletion),
    nodesByDocumentKey:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? snapshot.nodesByDocumentKey.remove(deletion.replaceableKey)
        : snapshot.nodesByDocumentKey,
    semanticIndex:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? removeNodesFromSemanticIndex(
            snapshot.semanticIndex,
            snapshot.nodesByDocumentKey.get(deletion.replaceableKey) ||
              ImmutableMap<string, GraphNode>()
          )
        : snapshot.semanticIndex,
  };
  const affectedAuthor = existingDocument?.author || deletion.author;
  return {
    ...nextSnapshot,
    knowledgeDBs: rebuildDocumentKnowledgeDBs({
      knowledgeDBs: nextSnapshot.knowledgeDBs,
      documents: nextSnapshot.documents,
      nodesByDocumentKey: nextSnapshot.nodesByDocumentKey,
      authors: [affectedAuthor],
    }),
  };
}

export function applyRecordsToSnapshot(
  snapshot: DocumentSnapshot,
  documents: ReadonlyArray<StoredDocumentRecord>,
  deletes: ReadonlyArray<StoredDeleteRecord>
): DocumentSnapshot {
  const withDocuments = documents.reduce(
    (acc, document) => applyDocumentToSnapshot(acc, document),
    snapshot
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToSnapshot(acc, deletion),
    withDocuments
  );
}

export function applyChangeToSnapshot(
  snapshot: DocumentSnapshot,
  change: DocumentStoreChange
): DocumentSnapshot {
  if (change.type === "document-put") {
    return applyDocumentToSnapshot(snapshot, change.document);
  }
  if (change.type === "delete-put") {
    return applyDeleteToSnapshot(snapshot, change.deletion);
  }
  if (change.type === "document-remove") {
    const existingDocument = snapshot.documents.get(change.replaceableKey);
    const existingNodes =
      snapshot.nodesByDocumentKey.get(change.replaceableKey) ||
      ImmutableMap<string, GraphNode>();
    if (!existingDocument) {
      return snapshot;
    }
    const nextSnapshot = {
      ...snapshot,
      documents: snapshot.documents.remove(change.replaceableKey),
      nodesByDocumentKey: snapshot.nodesByDocumentKey.remove(
        change.replaceableKey
      ),
      semanticIndex: removeNodesFromSemanticIndex(
        snapshot.semanticIndex,
        existingNodes
      ),
    };
    return {
      ...nextSnapshot,
      knowledgeDBs: rebuildDocumentKnowledgeDBs({
        knowledgeDBs: nextSnapshot.knowledgeDBs,
        documents: nextSnapshot.documents,
        nodesByDocumentKey: nextSnapshot.nodesByDocumentKey,
        authors: [existingDocument.author],
      }),
    };
  }
  const existingDelete = snapshot.deletes.get(change.replaceableKey);
  if (!existingDelete) {
    return snapshot;
  }
  return {
    ...snapshot,
    deletes: snapshot.deletes.remove(change.replaceableKey),
  };
}

export function createSnapshotFromStoredRecords(
  documents: ReadonlyArray<StoredDocumentRecord>,
  deletes: ReadonlyArray<StoredDeleteRecord>
): DocumentSnapshot {
  const latestDocuments = documents.reduce((acc, document) => {
    const existing = acc.get(document.replaceableKey);
    if (!existing || document.updatedMs > existing.updatedMs) {
      return acc.set(document.replaceableKey, document);
    }
    return acc;
  }, ImmutableMap<string, StoredDocumentRecord>());
  const latestDeletes = deletes.reduce((acc, deletion) => {
    const existing = acc.get(deletion.replaceableKey);
    if (!existing || deletion.deletedAt > existing.deletedAt) {
      return acc.set(deletion.replaceableKey, deletion);
    }
    return acc;
  }, ImmutableMap<string, StoredDeleteRecord>());
  const liveDocuments = latestDocuments.filter((document) => {
    const deletion = latestDeletes.get(document.replaceableKey);
    return !deletion || document.updatedMs > deletion.deletedAt;
  });
  const nodesByDocumentKey = ImmutableMap<
    string,
    ImmutableMap<string, GraphNode>
  >(
    liveDocuments
      .valueSeq()
      .map(
        (document) =>
          [document.replaceableKey, parseStoredDocumentNodes(document)] as [
            string,
            ImmutableMap<string, GraphNode>
          ]
      )
      .toArray()
  );
  const baseSnapshot = {
    documents: liveDocuments,
    deletes: latestDeletes,
    nodesByDocumentKey,
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: buildSemanticIndexFromDocuments(nodesByDocumentKey),
  };
  const authors = [
    ...new Set(
      liveDocuments
        .valueSeq()
        .map((document) => document.author)
        .toArray()
    ),
  ];
  return {
    ...baseSnapshot,
    knowledgeDBs: rebuildDocumentKnowledgeDBs({
      knowledgeDBs: baseSnapshot.knowledgeDBs,
      documents: baseSnapshot.documents,
      nodesByDocumentKey: baseSnapshot.nodesByDocumentKey,
      authors,
    }),
  };
}
