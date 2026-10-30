import { Set as ImmutableSet } from "immutable";
import { EMPTY_NODE_ID } from "./core/connections";
import { embeddedTarget } from "./core/nodeSpans";
import { calendarIdOf, embeddedFeedUrl } from "./core/ical";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  GraphLookup,
  ResolvedNode,
  fileTopRowRef,
  resolveChildOf,
  resolveRef,
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

export function embedTargetOf(
  node: GraphNode,
  sourceId: SourceId
): NodeRef | undefined {
  const url = embeddedFeedUrl(node);
  return (
    embeddedTarget(node, sourceId) ??
    (url !== undefined ? { sourceId: LOCAL, id: calendarIdOf(url) } : undefined)
  );
}

function embedTargetKey(
  graph: GraphLookup,
  resolved: ResolvedNode
): string | undefined {
  const target = embedTargetOf(resolved.node, resolved.ref.sourceId);
  return target ? nodeRefKey(fileTopRowRef(graph, target)) : undefined;
}

function claimsBelow(
  graph: GraphLookup,
  parent: ResolvedNode,
  walk: { visited: ImmutableSet<string>; claims: ImmutableSet<string> }
): { visited: ImmutableSet<string>; claims: ImmutableSet<string> } {
  return parent.node.children.toArray().reduce((acc, childID) => {
    if (childID === EMPTY_NODE_ID) {
      return acc;
    }
    const child = resolveChildOf(graph, parent, childID);
    const childKey = child ? nodeRefKey(child.ref) : undefined;
    if (!child || !childKey || acc.visited.has(childKey)) {
      return acc;
    }
    const targetKey = embedTargetKey(graph, child);
    if (targetKey !== undefined) {
      return {
        visited: acc.visited.add(childKey),
        claims: acc.claims.add(targetKey),
      };
    }
    return claimsBelow(graph, child, {
      visited: acc.visited.add(childKey),
      claims: acc.claims,
    });
  }, walk);
}

function diffClaims(
  graph: GraphLookup,
  parents: readonly ResolvedNode[]
): ImmutableSet<string> {
  return parents.reduce((walk, parent) => claimsBelow(graph, parent, walk), {
    visited: ImmutableSet<string>(),
    claims: ImmutableSet<string>(),
  }).claims;
}

function priorShowing(
  id: string,
  ancestors: ImmutableSet<string>,
  winners: ImmutableSet<string>
): { cycle: boolean; demoted: boolean } {
  const cycle = ancestors.has(id);
  return { cycle, demoted: !cycle && winners.has(id) };
}

/* eslint-disable functional/no-let, functional/immutable-data */
function sourceChain(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  ancestorsBefore: ImmutableSet<string>,
  winnersBefore: ImmutableSet<string>
): {
  links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
    demoted: boolean;
  }[];
  ancestors: ImmutableSet<string>;
  winners: ImmutableSet<string>;
} {
  const links = [];
  let current = { resolved, reached };
  let ancestors = ancestorsBefore;
  let winners = winnersBefore;
  for (;;) {
    ancestors = ancestors.add(nodeRefKey(current.resolved.ref));
    winners = winners.add(nodeRefKey(current.resolved.ref));
    const targetRef = embedTargetOf(
      current.resolved.node,
      current.resolved.ref.sourceId
    );
    const prior =
      targetRef !== undefined
        ? priorShowing(
            nodeRefKey(fileTopRowRef(graph, targetRef)),
            ancestors,
            winners
          )
        : { cycle: false, demoted: false };
    links.push({ ...current, ...prior });
    const target =
      targetRef === undefined || prior.cycle || prior.demoted
        ? undefined
        : resolveRef(graph, targetRef);
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
  winners: ImmutableSet<string>
): { showing: Showing; winners: ImmutableSet<string> } {
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
  ancestors: ImmutableSet<string>,
  winners: ImmutableSet<string>,
  claims: ImmutableSet<string>,
  inProjection: boolean
): { showing: Showing; winners: ImmutableSet<string> } {
  if (reached.kind === "line") {
    const key = nodeRefKey(resolved.ref);
    const prior = priorShowing(key, ancestors, winners);
    const claimed = inProjection && claims.has(key);
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
    winnersBefore: ImmutableSet<string>
  ): { children: Showing[]; winners: ImmutableSet<string> } => {
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
    winnersBefore: ImmutableSet<string>
  ): { showing: Showing; winners: ImmutableSet<string> } => {
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
    embedTargetOf(presented.node, presented.ref.sourceId) !== undefined &&
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
