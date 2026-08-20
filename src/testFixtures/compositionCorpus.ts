import { Map } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { parseToDocumentPreservingExplicitIds } from "../core/Document";
import { accessibleLineText } from "../core/markdownTree";
import { spansToMarkdown } from "../core/nodeSpans";
import { GraphLookup, lookupNode } from "../core/graphLookup";
import { createEmptyGraphIndex } from "../graphIndex";
import {
  Showing,
  closesCycle,
  leavesDangling,
  presentedLineOf,
  projectedChildShowings,
  showingTreeForRoot,
} from "../showings";

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

function expectedTreeLines(
  showing: Showing,
  depth: number,
  projected: boolean
): string[] {
  if (showing.node.relevance === "not_relevant") {
    return [];
  }
  const identity = `${projected ? "base" : "id"}:${showing.node.id}`;
  const flags = `${closesCycle(showing) ? " flag:cycle" : ""}${
    leavesDangling(showing) ? " flag:dangling" : ""
  }`;
  const text = accessibleLineText(
    spansToMarkdown(presentedLineOf(showing).node.spans)
  );
  const line = `${"  ".repeat(depth)}${rowMarker(
    showing.node
  )}${text} <!-- ${identity}${flags} -->`;
  return [
    line,
    ...projectedChildShowings(showing.target).flatMap(({ child }) =>
      expectedTreeLines(child, depth + 1, true)
    ),
    ...showing.children.flatMap((child) =>
      expectedTreeLines(child, depth + 1, projected)
    ),
  ];
}

export function projectExpectedTree(roots: Showing[]): string {
  return roots
    .flatMap((root) => expectedTreeLines(root, 0, false))
    .map((line) => `${line}\n`)
    .join("");
}

export function composeFixtureShowings(
  files: { name: string; content: string }[],
  openName: string
): Showing[] {
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
  return open.document.topNodeShortIds.flatMap((topNodeShortId) => {
    const resolved = lookupNode(graph, topNodeShortId, LOCAL);
    return resolved ? [showingTreeForRoot(graph, resolved)] : [];
  });
}

export function composeFixtureTree(
  files: { name: string; content: string }[],
  openName: string
): string {
  return projectExpectedTree(composeFixtureShowings(files, openName));
}
