import { Map } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { parseToDocumentPreservingExplicitIds } from "../core/Document";
import { nodeText } from "../core/nodeSpans";
import { GraphLookup, lookupNode } from "../core/graphLookup";
import { createEmptyGraphIndex } from "../graphIndex";
import { Showing, showingTreeForRoot } from "../treeTraversal";

const RELEVANCE_MARKS: Record<string, string> = {
  relevant: "!",
  maybe_relevant: "?",
  little_relevant: "~",
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

function expectedTreeLines(showing: Showing, depth: number): string[] {
  if (showing.node.relevance === "not_relevant") {
    return [];
  }
  const identity = `${showing.name.length > 1 ? "base" : "id"}:${
    showing.node.id
  }`;
  const flags = showing.cycle ? " flag:cycle" : "";
  const text = showing.standsFor?.liveText ?? nodeText(showing.node);
  const line = `${"  ".repeat(depth)}${rowMarker(
    showing.node
  )}${text} <!-- ${identity}${flags} -->`;
  return [
    line,
    ...showing.children.flatMap((child) => expectedTreeLines(child, depth + 1)),
  ];
}

export function projectExpectedTree(roots: Showing[]): string {
  return roots
    .flatMap((root) => expectedTreeLines(root, 0))
    .map((line) => `${line}\n`)
    .join("");
}

export function composeFixtureTree(
  files: { name: string; content: string }[],
  openName: string
): string {
  const parsed = files.map(({ name, content }) => ({
    name,
    ...parseToDocumentPreservingExplicitIds(LOCAL, content, {
      docIdFallback: `doc-${name}`,
      updatedMsOverride: 0,
    }),
  }));
  const nodes = parsed.reduce(
    (acc, { nodes: fileNodes }) => acc.merge(fileNodes),
    Map<ID, GraphNode>()
  );
  const graph: GraphLookup = {
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    localSourceId: LOCAL,
    sourceOrder: [LOCAL],
  };
  const open = parsed.find(({ name }) => name === openName);
  if (!open) {
    throw new Error(`Missing fixture file: ${openName}`);
  }
  return projectExpectedTree(
    open.document.topNodeShortIds.flatMap((topNodeShortId) => {
      const resolved = lookupNode(graph, topNodeShortId, LOCAL);
      return resolved ? [showingTreeForRoot(graph, resolved)] : [];
    })
  );
}
