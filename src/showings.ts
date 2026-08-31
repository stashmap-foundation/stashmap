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

export type PositionName = {
  kind: "after" | "before" | "parent";
  id: ID;
};

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
  inProjection: boolean;
  statement: boolean;
  names: PositionName[];
  spokenBy: ID[];
  lapsed: boolean;
  children: Showing[];
};

export function embedTargetOf(node: GraphNode): ID | undefined {
  const url = embeddedFeedUrl(node);
  return (
    embeddedTarget(node) ?? (url !== undefined ? calendarIdOf(url) : undefined)
  );
}

export function positionNamesOf(node: GraphNode): PositionName[] {
  return Object.entries(node.extraAttrs ?? {}).flatMap(
    ([key, id]): PositionName[] =>
      key === "after" || key === "before" || key === "parent"
        ? [{ kind: key, id }]
        : []
  );
}

export function isPositionedEmbedLine(node: GraphNode): boolean {
  return embedTargetOf(node) !== undefined && positionNamesOf(node).length > 0;
}

/* eslint-disable functional/no-let, functional/immutable-data */
function reachContains(
  graph: GraphLookup,
  fromId: ID,
  targetId: ID,
  sourceId: SourceId
): boolean {
  if (fromId === targetId) {
    return true;
  }
  const visited = new Set<ID>();
  const stack: ResolvedNode[] = [];
  const pushResolved = (resolved: ResolvedNode | undefined): void => {
    if (resolved && !visited.has(resolved.node.id)) {
      visited.add(resolved.node.id);
      stack.push(resolved);
    }
  };
  pushResolved(resolveAuthoredFirst(graph, fromId, sourceId));
  for (;;) {
    const current = stack.pop();
    if (!current) {
      return false;
    }
    if (current.node.id === targetId) {
      return true;
    }
    const opened = embedTargetOf(current.node);
    if (opened === targetId) {
      return true;
    }
    if (opened !== undefined) {
      pushResolved(resolveAuthoredFirst(graph, opened, current.ref.sourceId));
    }
    const found = current.node.children.toArray().some((childID) => {
      if (childID === EMPTY_NODE_ID) {
        return false;
      }
      if (childID === targetId) {
        return true;
      }
      pushResolved(resolveChildOf(graph, current, childID));
      return false;
    });
    if (found) {
      return true;
    }
  }
}
/* eslint-enable functional/no-let, functional/immutable-data */

function classifyPositioned(
  graph: GraphLookup,
  line: ResolvedNode,
  diffTarget: ID
): "move" | "own" | "add" {
  const targetId = embedTargetOf(line.node);
  if (targetId === undefined) {
    return "add";
  }
  if (reachContains(graph, diffTarget, targetId, line.ref.sourceId)) {
    return "move";
  }
  const resolved = resolveAuthoredFirst(graph, targetId, line.ref.sourceId);
  return resolved !== undefined && resolved.node.root === line.node.root
    ? "own"
    : "add";
}

function claimsBelow(
  graph: GraphLookup,
  parent: ResolvedNode,
  diffTarget: ID,
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
    const placement =
      targetID !== undefined &&
      (!isPositionedEmbedLine(child.node) ||
        classifyPositioned(graph, child, diffTarget) === "add");
    if (placement && targetID !== undefined) {
      return {
        visited: acc.visited.add(child.node.id),
        claims: acc.claims.add(targetID),
      };
    }
    return claimsBelow(graph, child, diffTarget, {
      visited: acc.visited.add(child.node.id),
      claims: acc.claims,
    });
  }, walk);
}

function diffClaims(
  graph: GraphLookup,
  parents: readonly ResolvedNode[]
): ImmutableSet<ID> {
  return parents.reduce(
    (walk, parent) => {
      const diffTarget = embedTargetOf(parent.node);
      return diffTarget === undefined
        ? walk
        : claimsBelow(graph, parent, diffTarget, walk);
    },
    {
      visited: ImmutableSet<ID>(),
      claims: ImmutableSet<ID>(),
    }
  ).claims;
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
  winnersBefore: ImmutableSet<ID>,
  statement: boolean
): {
  links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
    demoted: boolean;
    statement: boolean;
  }[];
  ancestors: ImmutableSet<ID>;
  winners: ImmutableSet<ID>;
} {
  const links: {
    resolved: ResolvedNode;
    reached: Showing["reached"];
    cycle: boolean;
    demoted: boolean;
    statement: boolean;
  }[] = [];
  let current = { resolved, reached };
  let ancestors = ancestorsBefore;
  let winners = winnersBefore;
  for (;;) {
    ancestors = ancestors.add(current.resolved.node.id);
    winners = winners.add(current.resolved.node.id);
    const lineStatement = links.length === 0 && statement;
    const targetID = lineStatement
      ? undefined
      : embedTargetOf(current.resolved.node);
    const prior =
      targetID !== undefined
        ? priorShowing(targetID, ancestors, winners)
        : { cycle: false, demoted: false };
    links.push({ ...current, ...prior, statement: lineStatement });
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
  winners: ImmutableSet<ID>,
  inProjection: boolean
): { showing: Showing; winners: ImmutableSet<ID> } {
  return {
    showing: {
      node: resolved.node,
      ref: resolved.ref,
      reached,
      target: undefined,
      cycle: false,
      demoted: true,
      inProjection,
      statement: false,
      names: positionNamesOf(resolved.node),
      spokenBy: [],
      lapsed: false,
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
  inProjection: boolean,
  diffTarget: ID | undefined,
  settle: (layer: Showing) => Showing
): { showing: Showing; winners: ImmutableSet<ID> } {
  if (reached.kind === "line") {
    const prior = priorShowing(resolved.node.id, ancestors, winners);
    const claimed = inProjection && claims.has(resolved.node.id);
    if (prior.cycle || prior.demoted || claimed) {
      return demotedLine(resolved, reached, winners, inProjection);
    }
  }
  const statement =
    reached.kind === "line" &&
    diffTarget !== undefined &&
    isPositionedEmbedLine(resolved.node) &&
    classifyPositioned(graph, resolved, diffTarget) !== "add";
  const chain = sourceChain(
    graph,
    resolved,
    reached,
    ancestors,
    winners,
    statement
  );
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
    linesDiffTarget: ID | undefined,
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
        linesInProjection,
        linesDiffTarget,
        settle
      );
      children.push(built.showing);
      childWinners = built.winners;
    });
    return { children, winners: childWinners };
  };
  /* eslint-enable functional/no-let, functional/immutable-data */
  const linkDiffTarget = (link: typeof chain.links[number]): ID | undefined => {
    if (link.statement) {
      return diffTarget;
    }
    const opened = embedTargetOf(link.resolved.node);
    if (opened !== undefined) {
      return opened;
    }
    return link.reached.kind === "target" ? undefined : diffTarget;
  };
  const mountLink = (
    link: typeof chain.links[number],
    target: Showing | undefined,
    winnersBefore: ImmutableSet<ID>
  ): { showing: Showing; winners: ImmutableSet<ID> } => {
    const linkInProjection =
      link.reached.kind === "target" ? true : inProjection;
    const lines = lineShowings(
      link.resolved,
      linkInProjection,
      linkDiffTarget(link),
      winnersBefore
    );
    const assembled: Showing = {
      node: link.resolved.node,
      ref: link.resolved.ref,
      reached: link.reached,
      target,
      cycle: link.cycle,
      demoted: link.demoted,
      inProjection: linkInProjection,
      statement: link.statement,
      names: link.statement ? [] : positionNamesOf(link.resolved.node),
      spokenBy: [],
      lapsed: false,
      children: lines.children,
    };
    // A mounted source finishes before the embedding document's diff
    // applies: its statements and names settle the moment it mounts.
    return {
      showing: link.reached.kind === "target" ? settle(assembled) : assembled,
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

export function chainLinksOf(showing: Showing): Showing[] {
  /* eslint-disable functional/no-let, functional/immutable-data */
  const links = [];
  let link: Showing | undefined = showing;
  while (link) {
    links.push(link);
    link = link.target;
  }
  return links;
  /* eslint-enable functional/no-let, functional/immutable-data */
}

export function linesShownThrough(
  target: Showing | undefined
): { source: Showing; line: Showing }[] {
  if (!target) {
    return [];
  }
  return [...chainLinksOf(target)]
    .reverse()
    .flatMap((source) => source.children.map((line) => ({ source, line })));
}

export function buildShowingTree(
  graph: GraphLookup,
  root: ResolvedNode,
  settle: (layer: Showing) => Showing
): Showing {
  return buildShowing(
    graph,
    root,
    { kind: "root" },
    ImmutableSet(),
    ImmutableSet(),
    ImmutableSet(),
    false,
    undefined,
    settle
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
