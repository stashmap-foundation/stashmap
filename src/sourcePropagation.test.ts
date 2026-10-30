import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { addNodesToGraphIndex, createEmptyGraphIndex } from "./graphIndex";
import { buildReferenceItem } from "./buildReferenceRow";
import { graphLookupFromData } from "./core/graphLookup";
import { buildPaneTarget, ViewPath } from "./rowModel";
import { getNodesInTree } from "./treeTraversal";
import { plainSpans } from "./core/nodeSpans";

const LOCAL = "local" as PublicKey;
const SOURCE_A = "source-a" as PublicKey;
const SOURCE_B = "source-b" as PublicKey;

function testNode(
  author: PublicKey,
  id: ID,
  text: string,
  options: {
    children?: List<ID>;
    parent?: ID;
    root?: ID;
    spans?: InlineSpan[];
  } = {}
): GraphNode {
  return {
    children: options.children ?? List<ID>(),
    id,
    spans: options.spans ?? plainSpans(text),
    parent: options.parent,
    updated: 1,
    root: options.root ?? id,
    relevance: undefined,
  };
}

function indexedData(entries: ReadonlyArray<[PublicKey, GraphNode[]]>): Data {
  const knowledgeDBs = Map<SourceId, KnowledgeData>(
    entries.map(([sourceId, nodes]) => [
      sourceId,
      { nodes: Map<ID, GraphNode>(nodes.map((node) => [node.id, node])) },
    ])
  );
  const graphIndex = entries.reduce(
    (index, [sourceId, nodes]) =>
      addNodesToGraphIndex(
        index,
        Map<ID, GraphNode>(nodes.map((node) => [node.id, node])),
        sourceId
      ),
    createEmptyGraphIndex()
  );
  return {
    user: { publicKey: LOCAL },
    knowledgeDBs,
    graphIndex,
    documents: Map(),
    computedNodes: Map(),
    publishEventsStatus: {
      isLoading: false,
      unsignedEvents: List(),
      results: Map(),
      temporaryView: {
        rowFocusIntents: Map<number, RowFocusIntent>(),
        baseSelection: OrderedSet<string>(),
        shiftSelection: OrderedSet<string>(),
        anchor: "",
        editingViews: ImmutableSet<string>(),
        editorOpenViews: ImmutableSet<string>(),
        draftTexts: Map<string, string>(),
      },
      temporaryEvents: List(),
    },
    views: Map<string, View>(),
    panes: [
      {
        id: "pane-0",
        sourceId: SOURCE_B,
        rootNodeId: "doc.md#root",
      },
    ],
  };
}

function duplicateSourceData(): Data {
  const rootA = testNode(SOURCE_A, "doc.md#root", "Root A", {
    children: List<ID>(["doc.md#child", "doc.md#link"]),
  });
  const childA = testNode(SOURCE_A, "doc.md#child", "Child A", {
    parent: "doc.md#root",
    root: "doc.md#root",
  });
  const targetA = testNode(SOURCE_A, "doc.md#target", "Target A", {
    root: "doc.md#root",
  });
  const linkA = testNode(SOURCE_A, "doc.md#link", "", {
    parent: "doc.md#root",
    root: "doc.md#root",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  const rootB = testNode(SOURCE_B, "doc.md#root", "Root B", {
    children: List<ID>(["doc.md#child", "doc.md#link"]),
  });
  const childB = testNode(SOURCE_B, "doc.md#child", "Child B", {
    parent: "doc.md#root",
    root: "doc.md#root",
  });
  const targetB = testNode(SOURCE_B, "doc.md#target", "Target B", {
    root: "doc.md#root",
  });
  const linkB = testNode(SOURCE_B, "doc.md#link", "", {
    parent: "doc.md#root",
    root: "doc.md#root",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  return indexedData([
    [SOURCE_A, [rootA, childA, targetA, linkA]],
    [SOURCE_B, [rootB, childB, targetB, linkB]],
  ]);
}

test("tree rows and fullscreen targets stay in the pane source for duplicate ids", () => {
  const data = duplicateSourceData();
  const rootPath: ViewPath = [0, "doc.md#root"];

  const treeRows = getNodesInTree(
    data,
    List<ViewPath>([rootPath]),
    "doc.md#root",
    SOURCE_B,
    undefined
  ).rows;
  const childRow = treeRows.get(1);

  expect(childRow?.viewPath).toEqual([0, "doc.md#root", "doc.md#child"]);
  expect(childRow ? buildPaneTarget(data, childRow).sourceId : undefined).toBe(
    SOURCE_B
  );
  expect(
    childRow ? buildPaneTarget(data, childRow).rootNodeId : undefined
  ).toBe("doc.md#child");
});

test("incoming rows keep their source identity in the current source", () => {
  const data = duplicateSourceData();
  const parentNode = data.knowledgeDBs.get(SOURCE_B)?.nodes.get("doc.md#root");
  if (!parentNode) {
    throw new Error("Missing parent node");
  }
  const reference = buildReferenceItem(
    graphLookupFromData(data),
    "doc.md#link",
    data,
    SOURCE_B,
    "incoming",
    {
      ref: { sourceId: SOURCE_B, id: parentNode.id },
      node: parentNode,
      origin: "authored",
    }
  );

  expect(reference?.targetLabel).toBe("");
  expect(reference?.sourceId).toBe(SOURCE_B);
});

function incomingDuplicateData(): Data {
  const rootA = testNode(SOURCE_A, "doc.md#root-a", "Root A", {
    children: List<ID>(["doc.md#link-a"]),
  });
  const targetA = testNode(SOURCE_A, "doc.md#target", "Target A", {
    root: "doc.md#root-a",
  });
  const linkA = testNode(SOURCE_A, "doc.md#link-a", "", {
    parent: "doc.md#root-a",
    root: "doc.md#root-a",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  const rootB = testNode(SOURCE_B, "doc.md#root-b", "Root B", {
    children: List<ID>(["doc.md#link-b"]),
  });
  const targetB = testNode(SOURCE_B, "doc.md#target", "Target B", {
    root: "doc.md#root-b",
  });
  const linkB = testNode(SOURCE_B, "doc.md#link-b", "", {
    parent: "doc.md#root-b",
    root: "doc.md#root-b",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  return indexedData([
    [SOURCE_A, [rootA, targetA, linkA]],
    [SOURCE_B, [rootB, targetB, linkB]],
  ]);
}

test("incoming refs for duplicate ids stay scoped to the target source", () => {
  const baseData = incomingDuplicateData();
  const data = {
    ...baseData,
    panes: [{ ...baseData.panes[0], rootNodeId: "doc.md#target" }],
  };
  const incomingRows = getNodesInTree(
    data,
    List<ViewPath>([[0, "doc.md#target"]]),
    "doc.md#target",
    SOURCE_B,
    undefined
  ).rows.rest();

  expect(incomingRows.map((row) => row.viewPath).toArray()).toEqual([
    [0, "doc.md#target", "incoming:source-b:doc.md#root-b"],
  ]);
});

test("incoming ref owner rows keep source identity when owner ids also collide", () => {
  const rootA = testNode(SOURCE_A, "doc.md#root", "Root A", {
    children: List<ID>(["doc.md#link"]),
  });
  const targetA = testNode(SOURCE_A, "doc.md#target", "Target A", {
    root: "doc.md#root",
  });
  const linkA = testNode(SOURCE_A, "doc.md#link", "", {
    parent: "doc.md#root",
    root: "doc.md#root",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  const rootB = testNode(SOURCE_B, "doc.md#root", "Root B", {
    children: List<ID>(["doc.md#link"]),
  });
  const targetB = testNode(SOURCE_B, "doc.md#target", "Target B", {
    root: "doc.md#root",
  });
  const linkB = testNode(SOURCE_B, "doc.md#link", "", {
    parent: "doc.md#root",
    root: "doc.md#root",
    spans: [{ kind: "link", href: "#target", text: "" }],
  });

  const baseData = indexedData([
    [SOURCE_A, [rootA, targetA, linkA]],
    [SOURCE_B, [rootB, targetB, linkB]],
  ]);
  const data = {
    ...baseData,
    panes: [{ ...baseData.panes[0], rootNodeId: "doc.md#target" }],
  };
  const incomingRows = getNodesInTree(
    data,
    List<ViewPath>([[0, "doc.md#target"]]),
    "doc.md#target",
    SOURCE_B,
    undefined
  ).rows.rest();

  expect(incomingRows.map((row) => row.sourceId).toArray()).toEqual([SOURCE_B]);
  expect(incomingRows.map((row) => row.node.spans).toArray()).toEqual([
    [{ kind: "link", href: "#root", text: "Root B" }],
  ]);
});
