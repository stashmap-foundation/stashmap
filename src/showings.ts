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
  demoted: boolean;
  children: Showing[];
};

export function embedTargetOf(node: GraphNode): ID | undefined {
  const url = embeddedFeedUrl(node);
  return (
    embeddedTarget(node) ?? (url !== undefined ? calendarIdOf(url) : undefined)
  );
}

function claimsBelow(
  graph: GraphLookup,
  parent: ResolvedNode,
  walk: { seen: ImmutableSet<ID>; claims: ImmutableSet<ID> }
): { seen: ImmutableSet<ID>; claims: ImmutableSet<ID> } {
  return parent.node.children.toArray().reduce((acc, childID) => {
    if (childID === EMPTY_NODE_ID) {
      return acc;
    }
    const child = resolveChildOf(graph, parent, childID);
    if (!child || acc.seen.has(child.node.id)) {
      return acc;
    }
    const targetID = embedTargetOf(child.node);
    return claimsBelow(graph, child, {
      seen: acc.seen.add(child.node.id),
      claims: targetID !== undefined ? acc.claims.add(targetID) : acc.claims,
    });
  }, walk);
}

function diffClaims(
  graph: GraphLookup,
  parents: readonly ResolvedNode[]
): ImmutableSet<ID> {
  return parents.reduce(
    (walk, parent) => claimsBelow(graph, parent, walk),
    { seen: ImmutableSet<ID>(), claims: ImmutableSet<ID>() }
  ).claims;
}

/* eslint-disable functional/no-let, functional/immutable-data */
function sourceChain(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  openPath: ImmutableSet<ID>,
  shown: ImmutableSet<ID>
): {
  links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
    demoted: boolean;
  }[];
  open: ImmutableSet<ID>;
  seen: ImmutableSet<ID>;
} {
  const links = [];
  let current = { resolved, reached };
  let open = openPath;
  let seen = shown;
  for (;;) {
    open = open.add(current.resolved.node.id);
    seen = seen.add(current.resolved.node.id);
    const targetID = embedTargetOf(current.resolved.node);
    const cycle = targetID !== undefined && open.has(targetID);
    const demoted = targetID !== undefined && !cycle && seen.has(targetID);
    links.push({ ...current, cycle, demoted });
    const target =
      targetID === undefined || cycle || demoted
        ? undefined
        : resolveAuthoredFirst(graph, targetID, current.resolved.ref.sourceId);
    if (!target) {
      return { links, open, seen };
    }
    current = { resolved: target, reached: { kind: "target" } };
  }
}
/* eslint-enable functional/no-let, functional/immutable-data */

type Built = { showing: Showing; seen: ImmutableSet<ID> };

function demotedLine(
  resolved: ResolvedNode,
  reached: Showing["reached"],
  seen: ImmutableSet<ID>
): Built {
  return {
    showing: {
      node: resolved.node,
      ref: resolved.ref,
      reached,
      target: undefined,
      cycle: false,
      demoted: true,
      children: [],
    },
    seen,
  };
}

function buildShowing(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  openPath: ImmutableSet<ID>,
  shown: ImmutableSet<ID>,
  claims: ImmutableSet<ID>,
  projected: boolean
): Built {
  if (reached.kind === "line" && shown.has(resolved.node.id)) {
    return demotedLine(resolved, reached, shown);
  }
  if (reached.kind === "line" && projected && claims.has(resolved.node.id)) {
    return demotedLine(resolved, reached, shown);
  }
  const { links, open, seen } = sourceChain(
    graph,
    resolved,
    reached,
    openPath,
    shown
  );
  const chainClaims = diffClaims(
    graph,
    links.slice(0, -1).map((link) => link.resolved)
  );
  const activeClaims = claims.union(chainClaims);
  const lineShowings = (
    parent: ResolvedNode,
    parentProjected: boolean,
    seenBefore: ImmutableSet<ID>
  ): { children: Showing[]; seen: ImmutableSet<ID> } =>
    parent.node.children.toArray().reduce<{
      children: Showing[];
      seen: ImmutableSet<ID>;
    }>(
      (acc, childID, childIndex) => {
        if (childID === EMPTY_NODE_ID) {
          return acc;
        }
        const child = resolveChildOf(graph, parent, childID);
        if (!child) {
          return acc;
        }
        const built = buildShowing(
          graph,
          child,
          { kind: "line", childIndex },
          open,
          acc.seen,
          activeClaims,
          parentProjected
        );
        return {
          children: [...acc.children, built.showing],
          seen: built.seen,
        };
      },
      { children: [], seen: seenBefore }
    );
  const builtByLink = [...links].reverse().reduce<{
    childrenByLink: Showing[][];
    seen: ImmutableSet<ID>;
  }>(
    (acc, link) => {
      const linkProjected = link.reached.kind === "target" ? true : projected;
      const built = lineShowings(link.resolved, linkProjected, acc.seen);
      return {
        childrenByLink: [built.children, ...acc.childrenByLink],
        seen: built.seen,
      };
    },
    { childrenByLink: [], seen }
  );
  const mount = (
    link: typeof links[number],
    index: number,
    target: Showing | undefined
  ): Showing => ({
    node: link.resolved.node,
    ref: link.resolved.ref,
    reached: link.reached,
    target,
    cycle: link.cycle,
    demoted: link.demoted,
    children: builtByLink.childrenByLink[index],
  });
  const last = links.length - 1;
  const showing = links
    .slice(0, -1)
    .reduceRight(
      (inner, link, index) => mount(link, index, inner),
      mount(links[last], last, undefined)
    );
  return { showing, seen: builtByLink.seen };
}

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  return buildShowing(
    graph,
    root,
    { kind: "root" },
    ImmutableSet(),
    ImmutableSet(),
    ImmutableSet(),
    false
  ).showing;
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
    !presented.cycle &&
    !presented.demoted
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
