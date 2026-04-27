import { List, Map } from "immutable";
import { getNode } from "./connections";
import { parseDocumentContent } from "./markdownNodes";
import { renderDocumentMarkdown } from "./documentRenderer";
import { getNodesInTree } from "./treeTraversal";
import { ViewPath, viewPathToString } from "./ViewContext";
import { ALICE, applyDefaults } from "./utils.test";

const TEST_MARKDOWN = `# Root <!-- id:root nodeKind="topic" -->
- Topic <!-- id:topic nodeKind="topic" -->
  - Author <!-- id:author nodeKind="author" -->
    - Work <!-- id:work nodeKind="source" -->
      - (!) Thesis <!-- id:thesis nodeKind="statement" -->
        - Detail <!-- id:detail nodeKind="statement" -->
  - Empty Author <!-- id:empty-author nodeKind="author" -->
    - Empty Work <!-- id:empty-work nodeKind="source" -->
`;

function getRequiredNode(
  nodes: Map<string, GraphNode>,
  text: string
): GraphNode {
  const node = nodes.find((candidate) => candidate.text === text);
  if (!node) {
    throw new Error(`Missing node ${text}`);
  }
  return node;
}

function buildKnowledgeDBs(
  nodes: Map<string, GraphNode>
): Map<PublicKey, KnowledgeData> {
  return Map<PublicKey, KnowledgeData>({
    [ALICE.publicKey]: { nodes },
  });
}

function collectExpandedViews(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  path: ViewPath,
  views: Views = Map<string, View>()
): Views {
  const withCurrent =
    node.children.size > 0
      ? views.set(viewPathToString(path), { expanded: true })
      : views;
  return node.children.reduce((acc, childID) => {
    const child = getNode(knowledgeDBs, childID, ALICE.publicKey);
    return child
      ? collectExpandedViews(
          knowledgeDBs,
          child,
          [...path, child.id] as ViewPath,
          acc
        )
      : acc;
  }, withCurrent);
}

function buildData(nodeKindFilters: NodeKind[] | undefined): {
  data: Data;
  rootPath: ViewPath;
} {
  const nodes = parseDocumentContent({
    content: TEST_MARKDOWN,
    author: ALICE.publicKey,
  });
  const root = getRequiredNode(nodes, "Root");
  const rootPath = [0, root.id] as ViewPath;
  const knowledgeDBs = buildKnowledgeDBs(nodes);
  const views = collectExpandedViews(knowledgeDBs, root, rootPath);
  return {
    rootPath,
    data: applyDefaults({
      knowledgeDBs,
      views,
      panes: [
        {
          id: "pane-0",
          stack: [],
          author: ALICE.publicKey,
          nodeKindFilters,
        },
      ],
    }),
  };
}

function visibleRows(filters: NodeKind[]): { text: string; depth: number }[] {
  const { data, rootPath } = buildData(filters);
  const result = getNodesInTree(
    data,
    rootPath,
    [],
    List<ViewPath>(),
    undefined,
    ALICE.publicKey,
    undefined,
    filters
  );
  return result.paths
    .map((path) => {
      const key = viewPathToString(path);
      const node = getNode(
        data.knowledgeDBs,
        path[path.length - 1] as ID,
        ALICE.publicKey
      );
      return {
        text: node?.text || "",
        depth: result.displayDepths.get(key) ?? path.length - 1,
      };
    })
    .toArray();
}

test("nodeKind imports and exports through markdown comments", () => {
  const nodes = parseDocumentContent({
    content: TEST_MARKDOWN,
    author: ALICE.publicKey,
  });
  const root = getRequiredNode(nodes, "Root");
  const author = getRequiredNode(nodes, "Author");
  const work = getRequiredNode(nodes, "Work");
  const thesis = getRequiredNode(nodes, "Thesis");
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const markdownText = renderDocumentMarkdown(buildKnowledgeDBs(nodes), root);

  expect(root.nodeKind).toBe("topic");
  expect(author.nodeKind).toBe("author");
  expect(work.nodeKind).toBe("source");
  expect(thesis.nodeKind).toBe("statement");
  expect(markdownText).toContain('nodeKind="topic"');
  expect(markdownText).toContain('nodeKind="author"');
  expect(markdownText).toContain('nodeKind="source"');
  expect(markdownText).toContain('nodeKind="statement"');
});

test("node kind topic filter shows topics only", () => {
  expect(visibleRows(["topic"])).toEqual([{ text: "Topic", depth: 2 }]);
});

test("node kind author filter lifts authors when topics are hidden", () => {
  expect(visibleRows(["author"])).toEqual([
    { text: "Author", depth: 2 },
    { text: "Empty Author", depth: 2 },
  ]);
});

test("combined topic and author filters keep topic context", () => {
  expect(visibleRows(["topic", "author"])).toEqual([
    { text: "Topic", depth: 2 },
    { text: "Author", depth: 3 },
    { text: "Empty Author", depth: 3 },
  ]);
});

test("node kind source filter skips authors and lifts works", () => {
  expect(visibleRows(["source"])).toEqual([
    { text: "Work", depth: 2 },
    { text: "Empty Work", depth: 2 },
  ]);
});

test("node kind statement filter skips authors and sources", () => {
  expect(visibleRows(["statement"])).toEqual([
    { text: "Thesis", depth: 2 },
    { text: "Detail", depth: 3 },
  ]);
});
