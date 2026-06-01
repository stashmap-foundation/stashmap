import { List, Map as ImmutableMap } from "immutable";
import {
  createEmptyGraphData,
  deleteDocument,
  filePathKeyOf,
  getNodeFromGraphData,
  mergeGraphData,
  nodeKeyOf,
  removeNode,
  replaceDocument,
  upsertDocumentMetadata,
  upsertNode,
} from "./graphData";
import { Document, documentKeyOf } from "./Document";
import { fileLinkSpan, linkSpan, plainSpans } from "./nodeSpans";

const LOCAL = "local-source" as PublicKey;
const SOURCE = "remote-source" as PublicKey;

function doc(author: PublicKey, docId: string, filePath = "docs/root.md"): Document {
  return {
    author,
    docId,
    filePath,
    relativePath: filePath,
    title: docId,
    topNodeShortIds: ["root"],
    updatedMs: 1,
  };
}

function node(
  id: ID,
  author: PublicKey,
  options: Partial<GraphNode> = {}
): GraphNode {
  return {
    id,
    root: options.root ?? id,
    author,
    updated: options.updated ?? 1,
    children: options.children ?? List<ID>(),
    spans: options.spans ?? plainSpans(id),
    relevance: options.relevance,
    ...options,
  };
}

test("upsertNode updates node storage and semantic, incoming cref, file-link, lineage, and document indexes", () => {
  const document = doc(LOCAL, "doc-1");
  const target = node("target", LOCAL);
  const linkItem = node("link-item", LOCAL, {
    root: "root",
    parent: "root",
    spans: [linkSpan("target" as LongID, "link item")],
    basedOn: "source-node" as LongID,
    basedOnSource: SOURCE as SourceId,
  });
  const fileItem = node("file-item", LOCAL, {
    root: "root",
    parent: "root",
    spans: [fileLinkSpan("other.md", "other")],
  });
  const root = node("root", LOCAL, {
    docId: "doc-1",
    children: List<ID>(["link-item", "file-item"]),
  });

  const graphData = [root, target, linkItem, fileItem].reduce(
    (acc, entry) => upsertNode(acc, entry),
    upsertDocumentMetadata(createEmptyGraphData(), document)
  );

  expect(getNodeFromGraphData(graphData, "link-item", LOCAL)).toBe(linkItem);
  expect(graphData.semantic.get("link item")).toEqual(
    new Set([nodeKeyOf(LOCAL, "link-item")])
  );
  expect(graphData.incomingCrefs.get(nodeKeyOf(LOCAL, "target"))).toEqual(
    new Set([nodeKeyOf(LOCAL, "link-item")])
  );
  expect(
    graphData.incomingFileLinks.get(filePathKeyOf(LOCAL, "docs/other.md"))
  ).toEqual(new Set([nodeKeyOf(LOCAL, "file-item")]));
  expect(graphData.basedOnIndex.get(nodeKeyOf(SOURCE, "source-node"))).toEqual(
    new Set([nodeKeyOf(LOCAL, "link-item")])
  );
  expect(
    graphData.nodeKeysByDocument.get(documentKeyOf(LOCAL, "doc-1"))
  ).toEqual(
    new Set([
      nodeKeyOf(LOCAL, "root"),
      nodeKeyOf(LOCAL, "link-item"),
      nodeKeyOf(LOCAL, "file-item"),
    ])
  );
});

test("removeNode removes stale entries from every affected index", () => {
  const document = doc(LOCAL, "doc-1");
  const target = node("target", LOCAL);
  const linkItem = node("link-item", LOCAL, {
    root: "root",
    parent: "root",
    spans: [linkSpan("target" as LongID, "link item")],
    basedOn: "source-node" as LongID,
    basedOnSource: SOURCE as SourceId,
  });
  const graphData = [target, linkItem].reduce(
    (acc, entry) => upsertNode(acc, entry),
    upsertDocumentMetadata(createEmptyGraphData(), document)
  );

  const removed = removeNode(graphData, nodeKeyOf(LOCAL, "link-item"));

  expect(getNodeFromGraphData(removed, "link-item", LOCAL)).toBeUndefined();
  expect(removed.semantic.get("link item")).toBeUndefined();
  expect(removed.incomingCrefs.get(nodeKeyOf(LOCAL, "target"))).toBeUndefined();
  expect(removed.basedOnIndex.get(nodeKeyOf(SOURCE, "source-node"))).toBeUndefined();
  expect(removed.nodeKeysByDocument.get(documentKeyOf(LOCAL, "doc-1"))).toBeUndefined();
});

test("replaceDocument replaces prior document nodes without stale index entries", () => {
  const oldDoc = doc(LOCAL, "doc-1");
  const oldNode = node("old", LOCAL, {
    root: "old",
    docId: "doc-1",
    spans: [linkSpan("target" as LongID, "link item")],
  });
  const newNode = node("new", LOCAL, {
    root: "new",
    docId: "doc-1",
    spans: plainSpans("new text"),
  });
  const withOld = replaceDocument(createEmptyGraphData(), {
    document: oldDoc,
    nodes: ImmutableMap<string, GraphNode>([["old", oldNode]]),
  });

  const replaced = replaceDocument(withOld, {
    document: { ...oldDoc, topNodeShortIds: ["new"], updatedMs: 2 },
    nodes: ImmutableMap<string, GraphNode>([["new", newNode]]),
  });

  expect(getNodeFromGraphData(replaced, "old", LOCAL)).toBeUndefined();
  expect(replaced.incomingCrefs.get(nodeKeyOf(LOCAL, "target"))).toBeUndefined();
  expect(getNodeFromGraphData(replaced, "new", LOCAL)).toBe(newNode);
  expect(replaced.semantic.get("new text")).toEqual(
    new Set([nodeKeyOf(LOCAL, "new")])
  );
});

test("same node id in two sources remains exact-source addressable", () => {
  const localNode = node("duplicate", LOCAL);
  const sourceNode = node("duplicate", SOURCE);
  const graphData = upsertNode(
    upsertNode(createEmptyGraphData(), localNode),
    sourceNode
  );

  expect(getNodeFromGraphData(graphData, "duplicate", LOCAL)).toBe(localNode);
  expect(getNodeFromGraphData(graphData, "duplicate", SOURCE)).toBe(sourceNode);
});

test("mergeGraphData reindexes links after all source candidates are merged", () => {
  const target = node("target", LOCAL);
  const linkItem = node("link-item", SOURCE, {
    spans: [linkSpan("target" as LongID, "link item")],
  });
  const left = upsertNode(createEmptyGraphData(), linkItem);
  const right = upsertNode(createEmptyGraphData(), target);

  const merged = mergeGraphData(left, right);

  expect(merged.incomingCrefs.get(nodeKeyOf(LOCAL, "target"))).toEqual(
    new Set([nodeKeyOf(SOURCE, "link-item")])
  );
});

test("deleteDocument removes document metadata, file path, nodes, and membership", () => {
  const document = doc(LOCAL, "doc-1");
  const root = node("root", LOCAL, { docId: "doc-1" });
  const graphData = upsertNode(
    upsertDocumentMetadata(createEmptyGraphData(), document),
    root
  );
  const key = documentKeyOf(LOCAL, "doc-1");

  const deleted = deleteDocument(graphData, key);

  expect(deleted.documents.get(key)).toBeUndefined();
  expect(deleted.documentsByFilePath.get(filePathKeyOf(LOCAL, "docs/root.md"))).toBeUndefined();
  expect(getNodeFromGraphData(deleted, "root", LOCAL)).toBeUndefined();
  expect(deleted.nodeKeysByDocument.get(key)).toBeUndefined();
});
