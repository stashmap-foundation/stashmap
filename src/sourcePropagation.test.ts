import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { addNodesToGraphIndex, createEmptyGraphIndex } from "./graphIndex";
import { buildReferenceItem } from "./buildReferenceRow";
import { graphLookupFromData } from "./core/graphLookup";
import { buildPaneTarget, ViewPath } from "./rowModel";
import { getTreeChildren } from "./treeTraversal";
import { linkSpan, plainSpans } from "./core/nodeSpans";

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
  const knowledgeDBs = Map<PublicKey, KnowledgeData>(
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
        undefined,
        sourceId
      ),
    createEmptyGraphIndex()
  );
  return {
    user: { publicKey: LOCAL },
    knowledgeDBs,
    snapshotNodes: Map<string, Map<string, GraphNode>>(),
    graphIndex,
    documents: Map(),
    documentByFilePath: Map(),
    relaysInfos: Map(),
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
        author: SOURCE_B,
        sourceId: SOURCE_B,
        rootNodeId: "root",
      },
    ],
  };
}

function duplicateSourceData(): Data {
  const rootA = testNode(SOURCE_A, "root", "Root A", {
    children: List<ID>(["child", "link"]),
  });
  const childA = testNode(SOURCE_A, "child", "Child A", {
    parent: "root",
    root: "root",
  });
  const targetA = testNode(SOURCE_A, "target", "Target A", {
    root: "root",
  });
  const linkA = testNode(SOURCE_A, "link", "", {
    parent: "root",
    root: "root",
    spans: [linkSpan("target", "")],
  });

  const rootB = testNode(SOURCE_B, "root", "Root B", {
    children: List<ID>(["child", "link"]),
  });
  const childB = testNode(SOURCE_B, "child", "Child B", {
    parent: "root",
    root: "root",
  });
  const targetB = testNode(SOURCE_B, "target", "Target B", {
    root: "root",
  });
  const linkB = testNode(SOURCE_B, "link", "", {
    parent: "root",
    root: "root",
    spans: [linkSpan("target", "")],
  });

  return indexedData([
    [SOURCE_A, [rootA, childA, targetA, linkA]],
    [SOURCE_B, [rootB, childB, targetB, linkB]],
  ]);
}

test("tree rows and fullscreen targets stay in the pane source for duplicate ids", () => {
  const data = duplicateSourceData();
  const rootPath: ViewPath = [0, "root"];

  const children = getTreeChildren(data, rootPath, "root", SOURCE_B, undefined);
  const childRow = children.rows.first();

  expect(childRow?.viewPath).toEqual([0, "root", "child"]);
  expect(childRow ? buildPaneTarget(data, childRow).sourceId : undefined).toBe(
    SOURCE_B
  );
  expect(
    childRow ? buildPaneTarget(data, childRow).rootNodeId : undefined
  ).toBe("child");
});

test("reference rows resolve duplicate bare ids in the current source", () => {
  const data = duplicateSourceData();
  const parentNode = data.knowledgeDBs.get(SOURCE_B)?.nodes.get("root");
  if (!parentNode) {
    throw new Error("Missing parent node");
  }
  const reference = buildReferenceItem(
    graphLookupFromData(data),
    "link",
    data,
    SOURCE_B,
    undefined,
    undefined,
    parentNode,
    { ref: { sourceId: SOURCE_B, id: parentNode.id }, node: parentNode },
    undefined
  );

  expect(reference?.targetLabel).toBe("Target B");
  expect(reference?.sourceId).toBe(SOURCE_B);
});

function incomingDuplicateData(): Data {
  const rootA = testNode(SOURCE_A, "root-a", "Root A", {
    children: List<ID>(["link-a"]),
  });
  const targetA = testNode(SOURCE_A, "target", "Target A", {
    root: "root-a",
  });
  const linkA = testNode(SOURCE_A, "link-a", "", {
    parent: "root-a",
    root: "root-a",
    spans: [linkSpan("target", "")],
  });

  const rootB = testNode(SOURCE_B, "root-b", "Root B", {
    children: List<ID>(["link-b"]),
  });
  const targetB = testNode(SOURCE_B, "target", "Target B", {
    root: "root-b",
  });
  const linkB = testNode(SOURCE_B, "link-b", "", {
    parent: "root-b",
    root: "root-b",
    spans: [linkSpan("target", "")],
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
    panes: [{ ...baseData.panes[0], rootNodeId: "target" }],
  };
  const incomingRows = getTreeChildren(
    data,
    [0, "target"],
    "target",
    SOURCE_B,
    undefined
  );

  expect(incomingRows.rows.map((row) => row.viewPath).toArray()).toEqual([
    [0, "target", "root-b"],
  ]);
});

test("incoming ref owner rows keep source identity when owner ids also collide", () => {
  const rootA = testNode(SOURCE_A, "root", "Root A", {
    children: List<ID>(["link"]),
  });
  const targetA = testNode(SOURCE_A, "target", "Target A", {
    root: "root",
  });
  const linkA = testNode(SOURCE_A, "link", "", {
    parent: "root",
    root: "root",
    spans: [linkSpan("target", "")],
  });

  const rootB = testNode(SOURCE_B, "root", "Root B", {
    children: List<ID>(["link"]),
  });
  const targetB = testNode(SOURCE_B, "target", "Target B", {
    root: "root",
  });
  const linkB = testNode(SOURCE_B, "link", "", {
    parent: "root",
    root: "root",
    spans: [linkSpan("target", "")],
  });

  const baseData = indexedData([
    [SOURCE_A, [rootA, targetA, linkA]],
    [SOURCE_B, [rootB, targetB, linkB]],
  ]);
  const data = {
    ...baseData,
    panes: [{ ...baseData.panes[0], rootNodeId: "target" }],
  };
  const incomingRows = getTreeChildren(
    data,
    [0, "target"],
    "target",
    SOURCE_B,
    undefined
  );

  expect(incomingRows.rows.map((row) => row.sourceId).toArray()).toEqual([
    SOURCE_B,
  ]);
  expect(incomingRows.rows.map((row) => row.node.spans).toArray()).toEqual([
    [linkSpan("root", "Root B")],
  ]);
});
