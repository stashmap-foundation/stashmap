import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { LOCAL, pathOf } from "./core/nodeRef";
import {
  addNodesToGraphIndex,
  buildGraphIndexFromDocuments,
  createEmptyGraphIndex,
  removeNodesFromGraphIndex,
} from "./graphIndex";
import { eventToParsed, eventToDocumentDelete } from "./nostrEvents";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
} from "./core/Document";
import { newDB } from "./core/knowledge";

export type { Document, DocumentDelete, ParsedDocument };

type DocumentState = {
  documents: ImmutableMap<string, Document>;
  deletes: ImmutableMap<string, DocumentDelete>;
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
  documents: ImmutableMap<string, Document>;
  upsertDocument: (parsed: ParsedDocument) => void;
  deleteDocument: (del: DocumentDelete) => void;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createInitialState(
  records: ReadonlyArray<ParsedDocument>
): DocumentState {
  const documents = ImmutableMap<string, Document>(
    records.map((parsed) => [
      documentKeyOf(parsed.document.sourceId, parsed.document.docId),
      parsed.document,
    ])
  );
  const knowledgeDBs = records.reduce((acc, parsed) => {
    const db = acc.get(parsed.document.sourceId) ?? newDB();
    return acc.set(parsed.document.sourceId, {
      ...db,
      nodes: db.nodes.merge(parsed.nodes),
    });
  }, ImmutableMap<SourceId, KnowledgeData>());
  return {
    documents,
    deletes: ImmutableMap<string, DocumentDelete>(),
    knowledgeDBs,
    graphIndex: buildGraphIndexFromDocuments(
      records.map((parsed) => ({
        sourceId: parsed.document.sourceId,
        nodes: parsed.nodes,
      }))
    ),
  };
}

function nodesForDocument(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): ImmutableMap<string, GraphNode> {
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  if (!nodes) return ImmutableMap<string, GraphNode>();
  return nodes.filter((node) => pathOf(node.id) === document.docId);
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

function applyDocumentToState(
  state: DocumentState,
  parsed: ParsedDocument
): DocumentState {
  const doc = parsed.document;
  const key = documentKeyOf(doc.sourceId, doc.docId);
  const existingDocument = state.documents.get(key);
  const existingDelete = state.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= doc.updatedMs) {
    return state;
  }
  if (existingDocument && existingDocument.updatedMs >= doc.updatedMs) {
    return state;
  }

  const existingNodes = existingDocument
    ? nodesForDocument(state.knowledgeDBs, existingDocument)
    : ImmutableMap<string, GraphNode>();
  const nextDeletes =
    existingDelete && doc.updatedMs > existingDelete.deletedAt
      ? state.deletes.remove(key)
      : state.deletes;
  const withoutExistingNodes =
    existingDocument && existingNodes.size > 0
      ? removeNodesFromGraphIndex(
          state.graphIndex,
          existingNodes,
          existingDocument.sourceId
        )
      : state.graphIndex;
  const knowledgeDBsAfterRemove = withoutDocumentNodes(
    state.knowledgeDBs,
    existingDocument
  );
  const knowledgeDBs = withDocNodes(
    knowledgeDBsAfterRemove,
    doc.sourceId,
    parsed.nodes
  );
  return {
    documents: state.documents.set(key, doc),
    deletes: nextDeletes,
    knowledgeDBs,
    graphIndex: addNodesToGraphIndex(
      withoutExistingNodes,
      parsed.nodes,
      doc.sourceId
    ),
  };
}

function applyDeleteToState(
  state: DocumentState,
  deletion: DocumentDelete
): DocumentState {
  const key = documentKeyOf(deletion.sourceId, deletion.docId);
  const existingDocument = state.documents.get(key);
  const existingDelete = state.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return state;
  }

  const willDelete =
    !!existingDocument && existingDocument.updatedMs <= deletion.deletedAt;
  if (!willDelete) {
    return { ...state, deletes: state.deletes.set(key, deletion) };
  }
  const existingNodes = nodesForDocument(state.knowledgeDBs, existingDocument);
  return {
    documents: state.documents.remove(key),
    deletes: state.deletes.set(key, deletion),
    knowledgeDBs: withoutDocumentNodes(state.knowledgeDBs, existingDocument),
    graphIndex:
      existingNodes.size > 0
        ? removeNodesFromGraphIndex(
            state.graphIndex,
            existingNodes,
            existingDocument.sourceId
          )
        : state.graphIndex,
  };
}

function applyRecordsToState(
  state: DocumentState,
  records: ReadonlyArray<ParsedDocument>,
  deletes: ReadonlyArray<DocumentDelete>
): DocumentState {
  const withDocuments = records.reduce(
    (acc, parsed) => applyDocumentToState(acc, parsed),
    state
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToState(acc, deletion),
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
}: {
  children: React.ReactNode;
  localPubkey: PublicKey | undefined;
  unpublishedEvents?: List<UnsignedEvent>;
  initialDocuments?: ReadonlyArray<ParsedDocument>;
}): JSX.Element {
  const [storedState, setStoredState] = React.useState<DocumentState>(() =>
    createInitialState(initialDocuments)
  );
  const upsertDocument = React.useCallback((parsed: ParsedDocument) => {
    setStoredState((current) => applyDocumentToState(current, parsed));
  }, []);

  const deleteDocument = React.useCallback((del: DocumentDelete) => {
    setStoredState((current) => applyDeleteToState(current, del));
  }, []);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { records, deletes } = eventsToParsed(eventList, localPubkey);

      if (records.length === 0 && deletes.length === 0) {
        return;
      }

      setStoredState((current) =>
        applyRecordsToState(current, records, deletes)
      );
    },
    [localPubkey]
  );

  const activeState = React.useMemo(() => {
    const eventList = unpublishedEvents.toArray();
    const { records, deletes } = eventsToParsed(eventList, localPubkey);
    return applyRecordsToState(storedState, records, deletes);
  }, [storedState, unpublishedEvents, localPubkey]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeState.knowledgeDBs,
      graphIndex: activeState.graphIndex,
      documents: activeState.documents,
      upsertDocument,
      deleteDocument,
      addEvents,
    }),
    [activeState, upsertDocument, deleteDocument, addEvents]
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

export function useDocuments(): ImmutableMap<string, Document> {
  return (
    React.useContext(DocumentStoreContext)?.documents ||
    ImmutableMap<string, Document>()
  );
}
