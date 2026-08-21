import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { parseToDocumentPreservingExplicitIds } from "../core/Document";
import { accessibleLineText } from "../core/markdownTree";
import { spansToMarkdown } from "../core/nodeSpans";
import { GraphLookup, lookupNode } from "../core/graphLookup";
import { createEmptyGraphIndex } from "../graphIndex";
import { Showing, showingTreeForRoot } from "../showings";
import { getNodesInTree } from "../treeTraversal";
import type { ViewPath } from "../rowModel";

const CORPUS_FILTERS: Pane["typeFilters"] = [
  "relevant",
  "maybe_relevant",
  "little_relevant",
  "not_relevant",
  "contains",
];

const RELEVANCE_MARKS: Record<string, string> = {
  relevant: "!",
  maybe_relevant: "?",
  little_relevant: "~",
  not_relevant: "x",
};

const ARGUMENT_MARKS: Record<string, string> = {
  confirms: "+",
  contra: "-",
};

function rowMarker(node: GraphNode): string {
  const relevanceMark = node.relevance ? RELEVANCE_MARKS[node.relevance] : "";
  const argumentMark = node.argument ? ARGUMENT_MARKS[node.argument] : "";
  const marks = `${relevanceMark}${argumentMark}`;
  return marks ? `{${marks}} ` : "";
}

function printRow(row: Row): string {
  const indent = "  ".repeat(row.depth - 1);
  const text = accessibleLineText(
    spansToMarkdown(row.presentedSpans ?? row.node.spans)
  );
  const identity = `${row.projected ? "base" : "id"}:${row.node.id}`;
  const flags = `${row.cycle ? " flag:cycle" : ""}${
    row.dangling ? " flag:dangling" : ""
  }`;
  return `${indent}${rowMarker(
    row.node
  )}${text} <!-- ${identity}${flags} -->\n`;
}

function parseFixture(
  files: { name: string; content: string }[],
  openName: string
): { nodes: Map<ID, GraphNode>; topNodeShortIds: string[] } {
  const parsed = files.map(({ name, content }) => ({
    name,
    ...parseToDocumentPreservingExplicitIds(LOCAL, content, {
      docIdFallback: `doc-${name}`,
      updatedMsOverride: 0,
    }),
  }));
  const open = parsed.find(({ name }) => name === openName);
  if (!open) {
    throw new Error(`Missing fixture file: ${openName}`);
  }
  return {
    nodes: parsed.reduce(
      (acc, { nodes: fileNodes }) => acc.merge(fileNodes),
      Map<ID, GraphNode>()
    ),
    topNodeShortIds: open.document.topNodeShortIds,
  };
}

function fixtureData(nodes: Map<ID, GraphNode>): Data {
  return {
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    documents: Map(),
    documentByFilePath: Map(),
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
    panes: [{ id: "corpus", sourceId: LOCAL }],
  };
}

export function composeFixtureShowings(
  files: { name: string; content: string }[],
  openName: string
): Showing[] {
  const { nodes, topNodeShortIds } = parseFixture(files, openName);
  const graph: GraphLookup = {
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    localSourceId: LOCAL,
    sourceOrder: [LOCAL],
  };
  return topNodeShortIds.flatMap((topNodeShortId) => {
    const resolved = lookupNode(graph, topNodeShortId, LOCAL);
    return resolved ? [showingTreeForRoot(graph, resolved)] : [];
  });
}

export function composeFixtureTree(
  files: { name: string; content: string }[],
  openName: string
): string {
  const { nodes, topNodeShortIds } = parseFixture(files, openName);
  const { rows } = getNodesInTree(
    fixtureData(nodes),
    List<ViewPath>(topNodeShortIds.map((id): ViewPath => [0, id])),
    undefined,
    LOCAL,
    CORPUS_FILTERS,
    { expandAll: true }
  );
  return rows.map(printRow).join("");
}
