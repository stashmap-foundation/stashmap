import { List as ImmutableList, Set as ImmutableSet } from "immutable";
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
  answersTo: ID[];
  spokenFor: ID | undefined;
  spokenUnder: ID | undefined;
  lapsed: boolean;
  ambiguous: boolean;
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

export function carriesMarker(node: GraphNode): boolean {
  return node.relevance !== undefined || node.argument !== undefined;
}

function reachContains(
  graph: GraphLookup,
  fromId: ID,
  targetId: ID,
  sourceId: SourceId
): boolean {
  const visit = (
    resolved: ResolvedNode | undefined,
    visited: ImmutableSet<ID>
  ): { found: boolean; visited: ImmutableSet<ID> } => {
    if (!resolved || visited.has(resolved.node.id)) {
      return { found: false, visited };
    }
    if (resolved.node.id === targetId) {
      return { found: true, visited };
    }
    const seen = { found: false, visited: visited.add(resolved.node.id) };
    const opened = embedTargetOf(resolved.node);
    if (opened === targetId) {
      return { ...seen, found: true };
    }
    const throughEmbed =
      opened !== undefined
        ? visit(
            resolveAuthoredFirst(graph, opened, resolved.ref.sourceId),
            seen.visited
          )
        : seen;
    return resolved.node.children.toArray().reduce((acc, childID) => {
      if (acc.found || childID === EMPTY_NODE_ID) {
        return acc;
      }
      if (childID === targetId) {
        return { ...acc, found: true };
      }
      return visit(resolveChildOf(graph, resolved, childID), acc.visited);
    }, throughEmbed);
  };
  if (fromId === targetId) {
    return true;
  }
  return visit(resolveAuthoredFirst(graph, fromId, sourceId), ImmutableSet())
    .found;
}

function isStatementLine(
  graph: GraphLookup,
  line: ResolvedNode,
  diffTarget: ID
): boolean {
  const targetId = embedTargetOf(line.node);
  if (targetId === undefined) {
    return false;
  }
  if (!carriesMarker(line.node) && positionNamesOf(line.node).length === 0) {
    return false;
  }
  return reachContains(graph, diffTarget, targetId, line.ref.sourceId);
}

export function isStatementShapedLine(
  graph: GraphLookup,
  line: ResolvedNode
): boolean {
  if (embedTargetOf(line.node) === undefined) {
    return false;
  }
  const membershipEmbed = (
    currentId: ID | undefined,
    visited: ImmutableSet<ID>
  ): ResolvedNode | undefined => {
    if (currentId === undefined || visited.has(currentId)) {
      return undefined;
    }
    const current = resolveAuthoredFirst(graph, currentId, line.ref.sourceId);
    if (!current) {
      return undefined;
    }
    if (embedTargetOf(current.node) !== undefined) {
      return current;
    }
    return membershipEmbed(current.node.parent, visited.add(currentId));
  };
  const embed = membershipEmbed(line.node.parent, ImmutableSet());
  const diffTarget = embed ? embedTargetOf(embed.node) : undefined;
  return diffTarget !== undefined && isStatementLine(graph, line, diffTarget);
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
      targetID !== undefined && !isStatementLine(graph, child, diffTarget);
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
      answersTo: [],
      spokenFor: undefined,
      spokenUnder: undefined,
      lapsed: false,
      ambiguous: false,
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
  diffTarget: ID | undefined
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
    isStatementLine(graph, resolved, diffTarget);
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
  const lineShowings = (
    parent: ResolvedNode,
    linesInProjection: boolean,
    linesDiffTarget: ID | undefined,
    winnersBefore: ImmutableSet<ID>
  ): { children: Showing[]; winners: ImmutableSet<ID> } => {
    const lines = parent.node.children.toArray().reduce(
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
          chain.ancestors,
          acc.winners,
          activeClaims,
          linesInProjection,
          linesDiffTarget
        );
        return {
          children: acc.children.push(built.showing),
          winners: built.winners,
        };
      },
      {
        children: ImmutableList<Showing>(),
        winners: winnersBefore,
      }
    );
    return { children: lines.children.toArray(), winners: lines.winners };
  };
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
    return {
      showing: {
        node: link.resolved.node,
        ref: link.resolved.ref,
        reached: link.reached,
        target,
        cycle: link.cycle,
        demoted: link.demoted,
        inProjection: linkInProjection,
        statement: link.statement,
        names: link.statement ? [] : positionNamesOf(link.resolved.node),
        answersTo: [],
        spokenFor: undefined,
        spokenUnder: undefined,
        lapsed: false,
        ambiguous: false,
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

// Planned style exception: stack safety beats the no-mutation lint.
/* eslint-disable functional/no-let, functional/immutable-data */
export function chainLinksOf(showing: Showing): Showing[] {
  const links: Showing[] = [];
  let link: Showing | undefined = showing;
  while (link) {
    links.push(link);
    link = link.target;
  }
  return links;
}
/* eslint-enable functional/no-let, functional/immutable-data */

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
  root: ResolvedNode
): Showing {
  return buildShowing(
    graph,
    root,
    { kind: "root" },
    ImmutableSet(),
    ImmutableSet(),
    ImmutableSet(),
    false,
    undefined
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
