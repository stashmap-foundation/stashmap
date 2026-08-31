import { List, Map, OrderedSet, Set as ImmutableSet } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { parseToDocumentPreservingExplicitIds } from "../core/Document";
import { accessibleLineText } from "../core/markdownTree";
import { spansToMarkdown } from "../core/nodeSpans";
import {
  IcalEntry,
  computedNodesFromFeeds,
  embeddedFeedUrl,
  parseIcalFeed,
} from "../core/ical";
import { graphLookupFromData, lookupNode } from "../core/graphLookup";
import { createEmptyGraphIndex } from "../graphIndex";
import { Showing } from "../showings";
import { showingTreeForRoot } from "../settling";
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
  }${row.lapsed ? " flag:lapsed" : ""}`;
  return `${indent}${rowMarker(
    row.node
  )}${text} <!-- ${identity}${flags} -->\n`;
}

function parseFixture(
  files: { name: string; content: string }[],
  openName: string
): {
  nodes: Map<ID, GraphNode>;
  topNodeShortIds: string[];
  calendarFeeds: Map<string, IcalEntry[]>;
} {
  const parsed = files
    .filter(({ name }) => name.endsWith(".md"))
    .map(({ name, content }) => ({
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
  const nodes = parsed.reduce(
    (acc, { nodes: fileNodes }) => acc.merge(fileNodes),
    Map<ID, GraphNode>()
  );
  const feedFile = files.find(({ name }) => name.endsWith(".ics"));
  const feedUrls = ImmutableSet(
    nodes
      .valueSeq()
      .toArray()
      .flatMap((node) => {
        const url = embeddedFeedUrl(node);
        return url ? [url] : [];
      })
  );
  if (feedFile && feedUrls.size > 1) {
    throw new Error(
      "Fixture embeds several feed URLs but carries one feed.ics"
    );
  }
  const calendarFeeds = feedFile
    ? Map<string, IcalEntry[]>(
        feedUrls
          .toArray()
          .map((url): [string, IcalEntry[]] => [
            url,
            parseIcalFeed(feedFile.content),
          ])
      )
    : Map<string, IcalEntry[]>();
  return {
    nodes,
    topNodeShortIds: open.document.topNodeShortIds,
    calendarFeeds,
  };
}

function fixtureData(
  nodes: Map<ID, GraphNode>,
  calendarFeeds: Map<string, IcalEntry[]>
): Data {
  return {
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    computedNodes: computedNodesFromFeeds(calendarFeeds),
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

function printShowing(
  showing: Showing,
  indent: number,
  mounted: boolean
): string {
  const line = `${"  ".repeat(indent)}${mounted ? ">" : ""}${showing.node.id}${
    showing.cycle ? " cycle" : ""
  }${showing.demoted ? " demoted" : ""}${showing.lapsed ? " lapsed" : ""}\n`;
  const target = showing.target
    ? printShowing(showing.target, indent + 1, true)
    : "";
  const children = showing.children
    .map((child) => printShowing(child, indent + 1, false))
    .join("");
  return `${line}${target}${children}`;
}

function composeFixtureShowings(
  files: { name: string; content: string }[],
  openName: string
): Showing[] {
  const { nodes, topNodeShortIds, calendarFeeds } = parseFixture(
    files,
    openName
  );
  const graph = graphLookupFromData({
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    computedNodes: computedNodesFromFeeds(calendarFeeds),
  });
  return topNodeShortIds.flatMap((topNodeShortId) => {
    const resolved = lookupNode(graph, topNodeShortId, LOCAL);
    return resolved ? [showingTreeForRoot(graph, resolved)] : [];
  });
}

export function composeFixtureShowingTree(
  files: { name: string; content: string }[],
  openName: string
): string {
  return composeFixtureShowings(files, openName)
    .map((showing) => printShowing(showing, 0, false))
    .join("");
}

export function composeFixtureTree(
  files: { name: string; content: string }[],
  openName: string
): string {
  const { nodes, topNodeShortIds, calendarFeeds } = parseFixture(
    files,
    openName
  );
  const { rows } = getNodesInTree(
    fixtureData(nodes, calendarFeeds),
    List<ViewPath>(topNodeShortIds.map((id): ViewPath => [0, id])),
    undefined,
    LOCAL,
    CORPUS_FILTERS,
    { expandAll: true }
  );
  return rows.map(printRow).join("");
}
