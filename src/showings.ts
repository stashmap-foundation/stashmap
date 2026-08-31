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

type PositionName = { kind: "after" | "before" | "parent"; id: ID };

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
  lapsed: boolean;
  children: Showing[];
};

export function embedTargetOf(node: GraphNode): ID | undefined {
  const url = embeddedFeedUrl(node);
  return (
    embeddedTarget(node) ?? (url !== undefined ? calendarIdOf(url) : undefined)
  );
}

function positionNamesOf(node: GraphNode): PositionName[] {
  return Object.entries(node.extraAttrs ?? {}).flatMap(
    ([key, id]): PositionName[] =>
      key === "after" || key === "before" || key === "parent"
        ? [{ kind: key, id }]
        : []
  );
}

function isMoveStatement(node: GraphNode): boolean {
  return embedTargetOf(node) !== undefined && positionNamesOf(node).length > 0;
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
    if (targetID !== undefined && !isMoveStatement(child.node)) {
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
  inDiff: boolean
): { showing: Showing; winners: ImmutableSet<ID> } {
  if (reached.kind === "line") {
    const prior = priorShowing(resolved.node.id, ancestors, winners);
    const claimed = inProjection && claims.has(resolved.node.id);
    if (prior.cycle || prior.demoted || claimed) {
      return demotedLine(resolved, reached, winners, inProjection);
    }
  }
  const statement =
    reached.kind === "line" && inDiff && isMoveStatement(resolved.node);
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
    linesInDiff: boolean,
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
        linesInDiff
      );
      children.push(built.showing);
      childWinners = built.winners;
    });
    return { children, winners: childWinners };
  };
  /* eslint-enable functional/no-let, functional/immutable-data */
  const linkDiff = (link: typeof chain.links[number]): boolean => {
    if (link.statement) {
      return inDiff;
    }
    if (embedTargetOf(link.resolved.node) !== undefined) {
      return true;
    }
    return link.reached.kind === "target" ? false : inDiff;
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
      linkDiff(link),
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
        lapsed: false,
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

function chainLinksOf(showing: Showing): Showing[] {
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

function rowListsOf(showing: Showing): { owner: Showing; rows: Showing[] }[] {
  return [...chainLinksOf(showing)]
    .reverse()
    .map((link) => ({ owner: link, rows: link.children }));
}

function eachRow(showing: Showing, visit: (row: Showing) => void): void {
  rowListsOf(showing).forEach(({ rows }) =>
    rows.forEach((row) => {
      visit(row);
      eachRow(row, visit);
    })
  );
}

function statementScope(
  owner: Showing,
  ownerScope: Showing | undefined
): Showing | undefined {
  if (owner.statement) {
    return ownerScope;
  }
  if (embedTargetOf(owner.node) !== undefined) {
    return owner;
  }
  return owner.reached.kind === "line" ? ownerScope : undefined;
}

function collectStatements(
  showing: Showing,
  scope: Showing | undefined,
  out: { statement: Showing; scope: Showing | undefined }[]
): void {
  /* eslint-disable functional/immutable-data */
  rowListsOf(showing).forEach(({ owner, rows }) => {
    const rowScope = statementScope(owner, scope);
    rows.forEach((row) => {
      if (row.statement) {
        out.push({ statement: row, scope: rowScope });
      }
      collectStatements(row, rowScope, out);
    });
  });
  /* eslint-enable functional/immutable-data */
}

function findOccurrence(scope: Showing, id: ID): Showing | undefined {
  const search = (rows: Showing[]): Showing | undefined =>
    rows.reduce<Showing | undefined>((found, row) => {
      if (found) {
        return found;
      }
      if (row.node.id === id && !row.demoted && !row.cycle && !row.statement) {
        return row;
      }
      return search(rowListsOf(row).flatMap((list) => list.rows));
    }, undefined);
  return search(linesShownThrough(scope.target).map(({ line }) => line));
}

type StatementEffects = {
  applied: Set<Showing>;
  namesFor: Map<Showing, PositionName[]>;
  extraChildrenFor: Map<Showing, Showing[]>;
  aliasIdsFor: Map<Showing, ID[]>;
};

function rebuildWithoutStatements(
  showing: Showing,
  effects: StatementEffects
): { showing: Showing; aliases: [ID, Showing][] } {
  const rebuildLink = (
    link: Showing,
    inner: { showing: Showing; aliases: [ID, Showing][] } | undefined
  ): { showing: Showing; aliases: [ID, Showing][] } => {
    const kept = link.children
      .filter((child) => !effects.applied.has(child))
      .map((child) => rebuildWithoutStatements(child, effects));
    const adopted = (effects.extraChildrenFor.get(link) ?? []).map((child) =>
      rebuildWithoutStatements(child, effects)
    );
    const rebuilt: Showing = {
      ...link,
      target: inner?.showing,
      names: [...(effects.namesFor.get(link) ?? []), ...link.names],
      children: [...kept, ...adopted].map((child) => child.showing),
    };
    return {
      showing: rebuilt,
      aliases: [
        ...(effects.aliasIdsFor.get(link) ?? []).map((id): [ID, Showing] => [
          id,
          rebuilt,
        ]),
        ...(inner?.aliases ?? []),
        ...[...kept, ...adopted].flatMap((child) => child.aliases),
      ],
    };
  };
  const links = [...chainLinksOf(showing)].reverse();
  const [terminal, ...outer] = links;
  return outer.reduce(
    (inner, link) => rebuildLink(link, inner),
    rebuildLink(terminal, undefined)
  );
}

function applyMoveStatements(root: Showing): {
  showing: Showing;
  aliases: Map<ID, Showing>;
} {
  const collected: { statement: Showing; scope: Showing | undefined }[] = [];
  collectStatements(root, undefined, collected);
  if (collected.length === 0) {
    return { showing: root, aliases: new Map<ID, Showing>() };
  }
  const decisions = collected.map(({ statement, scope }) => {
    const targetId = embedTargetOf(statement.node);
    return {
      statement,
      target:
        scope !== undefined && targetId !== undefined
          ? findOccurrence(scope, targetId)
          : undefined,
    };
  });
  /* eslint-disable functional/immutable-data */
  const effects: StatementEffects = {
    applied: new Set<Showing>(),
    namesFor: new Map<Showing, PositionName[]>(),
    extraChildrenFor: new Map<Showing, Showing[]>(),
    aliasIdsFor: new Map<Showing, ID[]>(),
  };
  // Applied back to front so an outer statement's names take priority over an
  // inner one's while statements of one diff keep their file order.
  decisions.reduceRight<undefined>((ignored, { statement, target }) => {
    if (!target) {
      return ignored;
    }
    effects.applied.add(statement);
    effects.namesFor.set(target, [
      ...positionNamesOf(statement.node),
      ...(effects.namesFor.get(target) ?? []),
    ]);
    effects.aliasIdsFor.set(target, [
      statement.node.id,
      ...(effects.aliasIdsFor.get(target) ?? []),
    ]);
    effects.extraChildrenFor.set(target, [
      ...statement.children,
      ...(effects.extraChildrenFor.get(target) ?? []),
    ]);
    return ignored;
  }, undefined);
  /* eslint-enable functional/immutable-data */
  if (effects.applied.size === 0) {
    return { showing: root, aliases: new Map<ID, Showing>() };
  }
  const rebuilt = rebuildWithoutStatements(root, effects);
  return { showing: rebuilt.showing, aliases: new Map(rebuilt.aliases) };
}

type Draft = {
  of: Showing;
  target: Draft | undefined;
  entries: (Draft | { bookmark: Showing })[];
};

/* eslint-disable functional/no-let, functional/immutable-data, @typescript-eslint/no-use-before-define */
// The bookmark walk builds the new tree in place: an immutable append would
// copy every children array per inserted row, O(n²) on wide trees.
function readNames(root: Showing, aliases: Map<ID, Showing>): Showing {
  const index = new Map<ID, Showing>();
  index.set(root.node.id, root);
  eachRow(root, (row) => {
    if (!index.has(row.node.id)) {
      index.set(row.node.id, row);
    }
  });
  const lists = new Map<
    Showing,
    { before: Showing[]; after: Showing[]; child: Showing[] }
  >();
  const lapsedRows = new Set<Showing>();
  const noted = new Set<Showing>();
  eachRow(root, (row) => {
    if (row.names.length === 0) {
      return;
    }
    const found = row.names
      .map((name) => ({
        name,
        anchor: aliases.get(name.id) ?? index.get(name.id),
      }))
      .find(({ anchor }) => anchor !== undefined && anchor !== row);
    if (!found || found.anchor === undefined) {
      lapsedRows.add(row);
      return;
    }
    const entry = lists.get(found.anchor) ?? {
      before: [],
      after: [],
      child: [],
    };
    const listOf = (kind: PositionName["kind"]): Showing[] => {
      if (kind === "after") {
        return entry.after;
      }
      return kind === "before" ? entry.before : entry.child;
    };
    listOf(found.name.kind).push(row);
    lists.set(found.anchor, entry);
    noted.add(row);
  });
  if (noted.size === 0 && lapsedRows.size === 0) {
    return root;
  }
  const copied = new Map<Showing, Draft>();
  const place = (entries: Draft["entries"], row: Showing): void => {
    if (noted.has(row)) {
      entries.push({ bookmark: row });
      return;
    }
    unfold(entries, row);
  };
  const copyChain = (link: Showing | undefined): Draft | undefined => {
    if (!link) {
      return undefined;
    }
    return [...chainLinksOf(link)]
      .reverse()
      .reduce<Draft | undefined>((inner, chainLink) => {
        const draft: Draft = { of: chainLink, target: inner, entries: [] };
        chainLink.children.forEach((child) => place(draft.entries, child));
        return draft;
      }, undefined);
  };
  const emitRow = (row: Showing): Draft => {
    const draft: Draft = { of: row, target: undefined, entries: [] };
    copied.set(row, draft);
    draft.target = copyChain(row.target);
    row.children.forEach((child) => place(draft.entries, child));
    (lists.get(row)?.child ?? []).forEach((child) =>
      unfold(draft.entries, child)
    );
    return draft;
  };
  function unfold(entries: Draft["entries"], row: Showing): void {
    if (copied.has(row)) {
      return;
    }
    (lists.get(row)?.before ?? []).forEach((early) => unfold(entries, early));
    entries.push(emitRow(row));
    (lists.get(row)?.after ?? []).forEach((late) => unfold(entries, late));
  }
  const rootDraft = emitRow(root);
  const sweepDraft = (draft: Draft): void => {
    const chainDrafts = [];
    let link: Draft | undefined = draft;
    while (link) {
      chainDrafts.push(link);
      link = link.target;
    }
    chainDrafts.reverse().forEach((chainDraft) => {
      const { entries } = chainDraft;
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if ("bookmark" in entry) {
          if (copied.has(entry.bookmark)) {
            entries.splice(i, 1);
            i -= 1;
          } else {
            lapsedRows.add(entry.bookmark);
            const expansion: Draft["entries"] = [];
            unfold(expansion, entry.bookmark);
            entries.splice(i, 1, ...expansion);
            i -= 1;
          }
        } else {
          sweepDraft(entry);
        }
      }
    });
  };
  sweepDraft(rootDraft);
  const materializeDraft = (draft: Draft): Showing => {
    const chainDrafts = [];
    let link: Draft | undefined = draft;
    while (link) {
      chainDrafts.push(link);
      link = link.target;
    }
    const [terminal, ...outer] = chainDrafts.reverse();
    const materializeLink = (
      chainDraft: Draft,
      inner: Showing | undefined
    ): Showing => ({
      ...chainDraft.of,
      target: inner,
      lapsed: chainDraft.of.lapsed || lapsedRows.has(chainDraft.of),
      children: chainDraft.entries.flatMap((entry) =>
        "bookmark" in entry ? [] : [materializeDraft(entry)]
      ),
    });
    return outer.reduce(
      (inner, chainDraft) => materializeLink(chainDraft, inner),
      materializeLink(terminal, undefined)
    );
  };
  return materializeDraft(rootDraft);
}
/* eslint-enable functional/no-let, functional/immutable-data, @typescript-eslint/no-use-before-define */

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  const built = buildShowing(
    graph,
    root,
    { kind: "root" },
    ImmutableSet(),
    ImmutableSet(),
    ImmutableSet(),
    false,
    false
  ).showing;
  const staged = applyMoveStatements(built);
  return readNames(staged.showing, staged.aliases);
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
