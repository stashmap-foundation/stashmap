import { Set as ImmutableSet } from "immutable";
import { EMPTY_NODE_ID } from "./core/connections";
import { embeddedTarget } from "./core/nodeSpans";
import { calendarIdOf, embeddedFeedUrl } from "./core/ical";
import {
  GraphLookup,
  ResolvedNode,
  resolveAuthoredFirst,
  resolveChildOf,
} from "./core/graphLookup";

export type Showing = {
  node: GraphNode;
  ref: NodeRef;
  reached:
    | { kind: "root" }
    | { kind: "line"; childIndex: number }
    | { kind: "target" };
  target: Showing | undefined;
  cycle: boolean;
  children: Showing[];
};

export function embedTargetOf(node: GraphNode): ID | undefined {
  const url = embeddedFeedUrl(node);
  return (
    embeddedTarget(node) ?? (url !== undefined ? calendarIdOf(url) : undefined)
  );
}

/* eslint-disable functional/no-let, functional/immutable-data */
function sourceChain(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  openPath: ImmutableSet<ID>
): {
  links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
  }[];
  open: ImmutableSet<ID>;
} {
  const links = [];
  let current = { resolved, reached };
  let open = openPath;
  for (;;) {
    open = open.add(current.resolved.node.id);
    const targetID = embedTargetOf(current.resolved.node);
    const cycle = targetID !== undefined && open.has(targetID);
    links.push({ ...current, cycle });
    const target =
      targetID === undefined || cycle
        ? undefined
        : resolveAuthoredFirst(graph, targetID, current.resolved.ref.sourceId);
    if (!target) {
      return { links, open };
    }
    current = { resolved: target, reached: { kind: "target" } };
  }
}
/* eslint-enable functional/no-let, functional/immutable-data */

function buildShowing(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  openPath: ImmutableSet<ID>
): Showing {
  const { links, open } = sourceChain(graph, resolved, reached, openPath);
  const lineShowings = (parent: ResolvedNode): Showing[] =>
    parent.node.children.toArray().flatMap((childID, childIndex) => {
      if (childID === EMPTY_NODE_ID) {
        return [];
      }
      const child = resolveChildOf(graph, parent, childID);
      return child
        ? [buildShowing(graph, child, { kind: "line", childIndex }, open)]
        : [];
    });
  const mount = (
    link: typeof links[number],
    target: Showing | undefined
  ): Showing => ({
    node: link.resolved.node,
    ref: link.resolved.ref,
    reached: link.reached,
    target,
    cycle: link.cycle,
    children: lineShowings(link.resolved),
  });
  const last = links[links.length - 1];
  return links
    .slice(0, -1)
    .reduceRight((inner, link) => mount(link, inner), mount(last, undefined));
}

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  return buildShowing(graph, root, { kind: "root" }, ImmutableSet());
}

/* eslint-disable functional/no-let */
export function presentedLineOf(showing: Showing): Showing {
  let line = showing;
  while (line.target) {
    line = line.target;
  }
  return line;
}
/* eslint-enable functional/no-let */

export function standsForOf(showing: Showing): Row["standsFor"] {
  return showing.target ? { id: showing.target.node.id } : undefined;
}

/* eslint-disable functional/no-let */
export function closesCycle(showing: Showing): boolean {
  let line: Showing | undefined = showing;
  while (line) {
    if (line.cycle) {
      return true;
    }
    line = line.target;
  }
  return false;
}
/* eslint-enable functional/no-let */

export function leavesDangling(showing: Showing): boolean {
  const presented = presentedLineOf(showing);
  return (
    embedTargetOf(presented.node) !== undefined &&
    presented.target === undefined &&
    !presented.cycle
  );
}

/* eslint-disable functional/no-let, functional/immutable-data */
export function linesShownThrough(
  target: Showing | undefined
): { source: Showing; line: Showing }[] {
  const chain = [];
  let opened = target;
  while (opened) {
    chain.push(opened);
    opened = opened.target;
  }
  return [...chain]
    .reverse()
    .flatMap((source) => source.children.map((line) => ({ source, line })));
}
/* eslint-enable functional/no-let, functional/immutable-data */
