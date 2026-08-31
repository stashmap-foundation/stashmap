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
  walk: { visited: ImmutableSet<ID>; claims: ImmutableSet<ID> }
): { visited: ImmutableSet<ID>; claims: ImmutableSet<ID> } {
  return parent.node.children.toArray().reduce((acc, childID) => {
    if (childID === EMPTY_NODE_ID) {
      return acc;
    }
    const child = resolveChildOf(graph, parent, childID);
    if (!child || acc.visited.has(child.node.id)) {
      return acc;
    }
    const targetID = embedTargetOf(child.node);
    if (targetID !== undefined) {
      return {
        visited: acc.visited.add(child.node.id),
        claims: acc.claims.add(targetID),
      };
    }
    return claimsBelow(graph, child, {
      visited: acc.visited.add(child.node.id),
      claims: acc.claims,
    });
  }, walk);
}

function diffClaims(
  graph: GraphLookup,
  parents: readonly ResolvedNode[]
): ImmutableSet<ID> {
  return parents.reduce((walk, parent) => claimsBelow(graph, parent, walk), {
    visited: ImmutableSet<ID>(),
    claims: ImmutableSet<ID>(),
  }).claims;
}

function priorShowing(
  id: ID,
  ancestors: ImmutableSet<ID>,
  winners: ImmutableSet<ID>
): { cycle: boolean; demoted: boolean } {
  const cycle = ancestors.has(id);
  return { cycle, demoted: !cycle && winners.has(id) };
}

/* eslint-disable functional/no-let, functional/immutable-data */
function sourceChain(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  ancestorsBefore: ImmutableSet<ID>,
  winnersBefore: ImmutableSet<ID>
): {
  links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
    demoted: boolean;
  }[];
  ancestors: ImmutableSet<ID>;
  winners: ImmutableSet<ID>;
} {
  const links = [];
  let current = { resolved, reached };
  let ancestors = ancestorsBefore;
  let winners = winnersBefore;
  for (;;) {
    ancestors = ancestors.add(current.resolved.node.id);
    winners = winners.add(current.resolved.node.id);
    const targetID = embedTargetOf(current.resolved.node);
    const prior =
      targetID !== undefined
        ? priorShowing(targetID, ancestors, winners)
        : { cycle: false, demoted: false };
    links.push({ ...current, ...prior });
    const target =
      targetID === undefined || prior.cycle || prior.demoted
        ? undefined
        : resolveAuthoredFirst(graph, targetID, current.resolved.ref.sourceId);
    if (!target) {
      return { links, ancestors, winners };
    }
    current = { resolved: target, reached: { kind: "target" } };
  }
}
/* eslint-enable functional/no-let, functional/immutable-data */

function demotedLine(
  resolved: ResolvedNode,
  reached: Showing["reached"],
  winners: ImmutableSet<ID>
): { showing: Showing; winners: ImmutableSet<ID> } {
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
    winners,
  };
}

function buildShowing(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  ancestors: ImmutableSet<ID>,
  winners: ImmutableSet<ID>,
  claims: ImmutableSet<ID>,
  inProjection: boolean
): { showing: Showing; winners: ImmutableSet<ID> } {
  if (reached.kind === "line") {
    const prior = priorShowing(resolved.node.id, ancestors, winners);
    const claimed = inProjection && claims.has(resolved.node.id);
    if (prior.cycle || prior.demoted || claimed) {
      return demotedLine(resolved, reached, winners);
    }
  }
  const chain = sourceChain(graph, resolved, reached, ancestors, winners);
  const activeClaims = claims.union(
    diffClaims(
      graph,
      chain.links.slice(0, -1).map((link) => link.resolved)
    )
  );
  /* eslint-disable functional/no-let, functional/immutable-data */
  const lineShowings = (
    parent: ResolvedNode,
    linesInProjection: boolean,
    winnersBefore: ImmutableSet<ID>
  ): { children: Showing[]; winners: ImmutableSet<ID> } => {
    // Mutable accumulation: an immutable append copies the array per child, O(n²) on wide trees.
    const children: Showing[] = [];
    let childWinners = winnersBefore;
    parent.node.children.toArray().forEach((childID, childIndex) => {
      if (childID === EMPTY_NODE_ID) {
        return;
      }
      const child = resolveChildOf(graph, parent, childID);
      if (!child) {
        return;
      }
      const built = buildShowing(
        graph,
        child,
        { kind: "line", childIndex },
        chain.ancestors,
        childWinners,
        activeClaims,
        linesInProjection
      );
      children.push(built.showing);
      childWinners = built.winners;
    });
    return { children, winners: childWinners };
  };
  /* eslint-enable functional/no-let, functional/immutable-data */
  const mountLink = (
    link: typeof chain.links[number],
    target: Showing | undefined,
    winnersBefore: ImmutableSet<ID>
  ): { showing: Showing; winners: ImmutableSet<ID> } => {
    const lines = lineShowings(
      link.resolved,
      link.reached.kind === "target" ? true : inProjection,
      winnersBefore
    );
    return {
      showing: {
        node: link.resolved.node,
        ref: link.resolved.ref,
        reached: link.reached,
        target,
        cycle: link.cycle,
        demoted: link.demoted,
        children: lines.children,
      },
      winners: lines.winners,
    };
  };
  return chain.links
    .slice(0, -1)
    .reduceRight(
      (inner, link) => mountLink(link, inner.showing, inner.winners),
      mountLink(chain.links[chain.links.length - 1], undefined, chain.winners)
    );
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
