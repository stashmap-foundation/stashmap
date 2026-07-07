import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { LOCAL } from "./core/nodeRef";
import type { StoredSnapshotRecord } from "./infra/nostr/cache/indexedDB";
import {
  toStoredSnapshotRecord,
  materializeSnapshot,
  materializeSnapshotContent,
} from "./infra/snapshotStore";
import {
  addNodesToGraphIndex,
  createEmptyGraphIndex,
  removeNodesFromGraphIndex,
} from "./graphIndex";
import {
  depositToParsed,
  eventToParsed,
  eventToDocumentDelete,
  findTag,
} from "./nostrEvents";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";
import { snapshotIdForContent } from "./nodesDocumentEvent";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
} from "./core/Document";
import { newDB } from "./core/knowledge";

export type { Document, DocumentDelete, ParsedDocument };

type DocumentSnapshot = {
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  deletes: ImmutableMap<string, DocumentDelete>;
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
};

// Structural twin of WorkspaceSnapshotFile — DocumentStore must not import
// the fs-backed workspaceBackend module.
export type SnapshotContent = {
  snapshotId: string;
  content: string;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
  snapshotNodes: SnapshotNodes;
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  upsertDocument: (parsed: ParsedDocument) => void;
  deleteDocument: (del: DocumentDelete) => void;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
  // Attention-pulled deposits (34774): read-only foreign sources keyed by
  // event coordinate, replaceable per (pubkey, d), in-memory only.
  addDepositEvents: (events: ReadonlyArray<Event | UnsignedEvent>) => void;
  pulledAuthors: ReadonlyArray<SourceId>;
  addSnapshotContents: (snapshots: ReadonlyArray<SnapshotContent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createEmptySnapshot(): DocumentSnapshot {
  return {
    documents: ImmutableMap<string, Document>(),
    documentByFilePath: ImmutableMap<string, Document>(),
    deletes: ImmutableMap<string, DocumentDelete>(),
    knowledgeDBs: ImmutableMap<SourceId, KnowledgeData>(),
    graphIndex: createEmptyGraphIndex(),
  };
}

function nodesForDocument(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): ImmutableMap<string, GraphNode> {
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  if (!nodes) return ImmutableMap<string, GraphNode>();
  const topNodeIds = new Set(document.topNodeShortIds);
  return nodes.filter((node) => topNodeIds.has(node.root));
}

function withoutDocumentNodes(
  knowledgeDBs: KnowledgeDBs,
  document: Document | undefined
): KnowledgeDBs {
  if (!document) return knowledgeDBs;
  const db = knowledgeDBs.get(document.sourceId);
  if (!db) return knowledgeDBs;
  const documentNodes = nodesForDocument(knowledgeDBs, document);
  const filtered = db.nodes.filter((_, nodeId) => !documentNodes.has(nodeId));
  return filtered.size === 0
    ? knowledgeDBs.remove(document.sourceId)
    : knowledgeDBs.set(document.sourceId, { ...db, nodes: filtered });
}

function withDocNodes(
  knowledgeDBs: KnowledgeDBs,
  author: SourceId,
  nodes: ImmutableMap<string, GraphNode>
): KnowledgeDBs {
  if (nodes.size === 0) return knowledgeDBs;
  const db = knowledgeDBs.get(author) ?? newDB();
  return knowledgeDBs.set(author, { ...db, nodes: db.nodes.merge(nodes) });
}

function withDocumentInFilePathIndex(
  index: ImmutableMap<string, Document>,
  doc: Document
): ImmutableMap<string, Document> {
  return doc.filePath ? index.set(doc.filePath, doc) : index;
}

function withoutDocumentInFilePathIndex(
  index: ImmutableMap<string, Document>,
  doc: Document | undefined
): ImmutableMap<string, Document> {
  if (!doc?.filePath) return index;
  const current = index.get(doc.filePath);
  if (current && current.docId === doc.docId) {
    return index.remove(doc.filePath);
  }
  return index;
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  parsed: ParsedDocument
): DocumentSnapshot {
  const doc = parsed.document;
  const key = documentKeyOf(doc.sourceId, doc.docId);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= doc.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs >= doc.updatedMs) {
    return snapshot;
  }

  const existingNodes = existingDocument
    ? nodesForDocument(snapshot.knowledgeDBs, existingDocument)
    : ImmutableMap<string, GraphNode>();
  const nextDeletes =
    existingDelete && doc.updatedMs > existingDelete.deletedAt
      ? snapshot.deletes.remove(key)
      : snapshot.deletes;
  const withoutExistingNodes =
    existingDocument && existingNodes.size > 0
      ? removeNodesFromGraphIndex(
          snapshot.graphIndex,
          existingNodes,
          existingDocument.filePath,
          existingDocument.sourceId
        )
      : snapshot.graphIndex;
  const documentByFilePathAfterRemove = withoutDocumentInFilePathIndex(
    snapshot.documentByFilePath,
    existingDocument
  );
  const knowledgeDBsAfterRemove = withoutDocumentNodes(
    snapshot.knowledgeDBs,
    existingDocument
  );
  const knowledgeDBs = withDocNodes(
    knowledgeDBsAfterRemove,
    doc.sourceId,
    parsed.nodes
  );
  return {
    documents: snapshot.documents.set(key, doc),
    documentByFilePath: withDocumentInFilePathIndex(
      documentByFilePathAfterRemove,
      doc
    ),
    deletes: nextDeletes,
    knowledgeDBs,
    graphIndex: addNodesToGraphIndex(
      withoutExistingNodes,
      parsed.nodes,
      doc.filePath,
      doc.sourceId
    ),
  };
}

function applyDeleteToSnapshot(
  snapshot: DocumentSnapshot,
  deletion: DocumentDelete
): DocumentSnapshot {
  const key = documentKeyOf(deletion.sourceId, deletion.docId);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return snapshot;
  }

  const willDelete =
    !!existingDocument && existingDocument.updatedMs <= deletion.deletedAt;
  if (!willDelete) {
    return { ...snapshot, deletes: snapshot.deletes.set(key, deletion) };
  }
  const existingNodes = nodesForDocument(
    snapshot.knowledgeDBs,
    existingDocument
  );
  return {
    documents: snapshot.documents.remove(key),
    documentByFilePath: withoutDocumentInFilePathIndex(
      snapshot.documentByFilePath,
      existingDocument
    ),
    deletes: snapshot.deletes.set(key, deletion),
    knowledgeDBs: withoutDocumentNodes(snapshot.knowledgeDBs, existingDocument),
    graphIndex:
      existingNodes.size > 0
        ? removeNodesFromGraphIndex(
            snapshot.graphIndex,
            existingNodes,
            existingDocument.filePath,
            existingDocument.sourceId
          )
        : snapshot.graphIndex,
  };
}

function applyRecordsToSnapshot(
  snapshot: DocumentSnapshot,
  records: ReadonlyArray<ParsedDocument>,
  deletes: ReadonlyArray<DocumentDelete>
): DocumentSnapshot {
  const withDocuments = records.reduce(
    (acc, parsed) => applyDocumentToSnapshot(acc, parsed),
    snapshot
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToSnapshot(acc, deletion),
    withDocuments
  );
}

function parsedWithSource(
  parsed: ParsedDocument,
  sourceId: SourceId
): ParsedDocument {
  return {
    document: { ...parsed.document, sourceId },
    nodes: parsed.nodes,
  };
}

function eventsToParsed(
  events: ReadonlyArray<Event | UnsignedEvent>,
  localPubkey: PublicKey | undefined
): {
  readonly records: ReadonlyArray<ParsedDocument>;
  readonly deletes: ReadonlyArray<DocumentDelete>;
} {
  return {
    records: events
      .map((event) => eventToParsed(event))
      .filter((parsed): parsed is ParsedDocument => parsed !== undefined)
      .map((parsed) =>
        parsed.document.sourceId === localPubkey
          ? parsedWithSource(parsed, LOCAL)
          : parsed
      ),
    deletes: events
      .map((event) => eventToDocumentDelete(event))
      .filter((del): del is DocumentDelete => del !== undefined)
      .map((del) =>
        del.sourceId === localPubkey ? { ...del, sourceId: LOCAL } : del
      ),
  };
}

export function DocumentStoreProvider({
  children,
  localPubkey,
  unpublishedEvents = List<UnsignedEvent>(),
  initialDocuments = [],
  initialSnapshots = [],
}: {
  children: React.ReactNode;
  localPubkey: PublicKey | undefined;
  unpublishedEvents?: List<UnsignedEvent>;
  initialDocuments?: ReadonlyArray<ParsedDocument>;
  initialSnapshots?: ReadonlyArray<SnapshotContent>;
}): JSX.Element {
  const [snapshot, setSnapshot] = React.useState<DocumentSnapshot>(() =>
    applyRecordsToSnapshot(createEmptySnapshot(), initialDocuments, [])
  );
  const [snapshotNodes, setSnapshotNodes] = React.useState<SnapshotNodes>(() =>
    ImmutableMap(
      initialSnapshots.map((snap) => [
        snap.snapshotId,
        materializeSnapshotContent(snap.snapshotId, snap.content),
      ])
    )
  );

  const addSnapshotContents = React.useCallback(
    (snapshots: ReadonlyArray<SnapshotContent>) => {
      setSnapshotNodes((prev) =>
        snapshots.reduce(
          (acc, snap) =>
            acc.has(snap.snapshotId)
              ? acc
              : acc.set(
                  snap.snapshotId,
                  materializeSnapshotContent(snap.snapshotId, snap.content)
                ),
          prev
        )
      );
    },
    []
  );

  const upsertDocument = React.useCallback((parsed: ParsedDocument) => {
    setSnapshot((current) => applyDocumentToSnapshot(current, parsed));
  }, []);

  const deleteDocument = React.useCallback((del: DocumentDelete) => {
    setSnapshot((current) => applyDeleteToSnapshot(current, del));
  }, []);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { records, deletes } = eventsToParsed(eventList, localPubkey);

      const snapshotRecords = eventList
        .map((event) => toStoredSnapshotRecord(event))
        .filter(
          (record): record is StoredSnapshotRecord => record !== undefined
        );

      if (snapshotRecords.length > 0) {
        setSnapshotNodes((prev) =>
          snapshotRecords.reduce((acc, record) => {
            if (acc.has(record.dTag)) {
              return acc;
            }
            return acc.set(record.dTag, materializeSnapshot(record));
          }, prev)
        );
      }

      if (records.length === 0 && deletes.length === 0) {
        return;
      }

      setSnapshot((current) =>
        applyRecordsToSnapshot(current, records, deletes)
      );
    },
    [localPubkey]
  );

  const [depositEvents, setDepositEvents] = React.useState(
    ImmutableMap<string, Event | UnsignedEvent>()
  );

  const addDepositEvents = React.useCallback(
    (events: ReadonlyArray<Event | UnsignedEvent>) => {
      setDepositEvents((prev) =>
        events.reduce((acc, event) => {
          if (event.kind !== KIND_KNOWLEDGE_DEPOSIT) {
            return acc;
          }
          const dTag = findTag(event, "d");
          if (!dTag) {
            return acc;
          }
          const coordinate = `${event.pubkey}:${dTag}`;
          const existing = acc.get(coordinate);
          return existing && existing.created_at >= event.created_at
            ? acc
            : acc.set(coordinate, event);
        }, prev)
      );
    },
    []
  );

  // First-observation baselines: a deposit's content hashes to its
  // snapshot id by construction — the baseline a later take stamps.
  React.useEffect(() => {
    setSnapshotNodes((prev) =>
      depositEvents.reduce((acc, event) => {
        const snapshotId = snapshotIdForContent(event.content);
        return acc.has(snapshotId)
          ? acc
          : acc.set(
              snapshotId,
              materializeSnapshotContent(snapshotId, event.content)
            );
      }, prev)
    );
  }, [depositEvents]);

  const pulledAuthors = React.useMemo(
    () =>
      [
        ...new Set(
          depositEvents
            .valueSeq()
            .toArray()
            .map((event) => event.pubkey as SourceId)
        ),
      ].sort(),
    [depositEvents]
  );

  const activeSnapshot = React.useMemo(() => {
    const eventList = unpublishedEvents.toArray();
    const { records, deletes } = eventsToParsed(eventList, localPubkey);
    const depositRecords = depositEvents
      .valueSeq()
      .toArray()
      .map(depositToParsed)
      .filter((record): record is ParsedDocument => record !== undefined);
    return applyRecordsToSnapshot(
      snapshot,
      [...records, ...depositRecords],
      deletes
    );
  }, [snapshot, unpublishedEvents, localPubkey, depositEvents]);

  React.useEffect(() => {
    setSnapshotNodes((prev) =>
      unpublishedEvents.reduce((acc, event) => {
        const record = toStoredSnapshotRecord(event);
        if (!record || acc.has(record.dTag)) {
          return acc;
        }
        return acc.set(record.dTag, materializeSnapshot(record));
      }, prev)
    );
  }, [unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeSnapshot.knowledgeDBs,
      graphIndex: activeSnapshot.graphIndex,
      snapshotNodes,
      documents: activeSnapshot.documents,
      documentByFilePath: activeSnapshot.documentByFilePath,
      upsertDocument,
      deleteDocument,
      addEvents,
      addSnapshotContents,
      addDepositEvents,
      pulledAuthors,
    }),
    [
      activeSnapshot,
      upsertDocument,
      deleteDocument,
      addEvents,
      addSnapshotContents,
      addDepositEvents,
      pulledAuthors,
      snapshotNodes,
    ]
  );

  return (
    <DocumentStoreContext.Provider value={contextValue}>
      {children}
    </DocumentStoreContext.Provider>
  );
}

export function useDocumentStore(): DocumentStoreState | undefined {
  return React.useContext(DocumentStoreContext);
}

export function useDocumentKnowledgeDBs(): KnowledgeDBs {
  return React.useContext(DocumentStoreContext)?.knowledgeDBs || ImmutableMap();
}

export function useDocumentGraphIndex(): GraphIndex {
  return (
    React.useContext(DocumentStoreContext)?.graphIndex ||
    createEmptyGraphIndex()
  );
}

export function useDocumentSnapshotNodes(): SnapshotNodes {
  return (
    React.useContext(DocumentStoreContext)?.snapshotNodes || ImmutableMap()
  );
}

export function useDocumentPulledAuthors(): ReadonlyArray<SourceId> {
  return React.useContext(DocumentStoreContext)?.pulledAuthors ?? [];
}

export function useDocuments(): ImmutableMap<string, Document> {
  return (
    React.useContext(DocumentStoreContext)?.documents ||
    ImmutableMap<string, Document>()
  );
}

export function useDocumentByFilePath(): ImmutableMap<string, Document> {
  const ctx = React.useContext(DocumentStoreContext);
  if (!ctx) {
    throw new Error("useDocumentByFilePath used outside DocumentStoreProvider");
  }
  return ctx.documentByFilePath;
}
