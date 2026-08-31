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

function positionNamesOf(node: GraphNode): PositionName[] {
  return Object.entries(node.extraAttrs ?? {}).flatMap(
    ([key, id]): PositionName[] =>
      key === "after" || key === "before" || key === "parent"
        ? [{ kind: key, id }]
        : []
  );
}

export function isMoveStatement(node: GraphNode): boolean {
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
      (!isMoveStatement(child.node) ||
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
    isMoveStatement(resolved.node) &&
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
        linesDiffTarget
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
      showing:
        link.reached.kind === "target"
          ? // eslint-disable-next-line @typescript-eslint/no-use-before-define
            settleLayer(assembled)
          : assembled,
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

// A layer is one document's contribution: its own lines reached through
// children edges alone. Mounted sources below it settled when they mounted.
function collectLayerStatements(
  owner: Showing,
  scope: Showing | undefined,
  out: { statement: Showing; scope: Showing | undefined }[]
): void {
  /* eslint-disable functional/immutable-data */
  const rowScope = statementScope(owner, scope);
  owner.children.forEach((row) => {
    if (row.statement) {
      out.push({ statement: row, scope: rowScope });
    }
    collectLayerStatements(row, rowScope, out);
  });
  /* eslint-enable functional/immutable-data */
}

function layerNamedRows(owner: Showing, out: Showing[]): void {
  /* eslint-disable functional/immutable-data */
  owner.children.forEach((row) => {
    if (!row.statement && row.names.length > 0) {
      out.push(row);
    }
    layerNamedRows(row, out);
  });
  /* eslint-enable functional/immutable-data */
}

function answersTo(row: Showing, id: ID): boolean {
  return row.node.id === id || row.spokenBy.includes(id);
}

function findOccurrence(scope: Showing, id: ID): Showing | undefined {
  const search = (rows: Showing[]): Showing | undefined =>
    rows.reduce<Showing | undefined>((found, row) => {
      if (found) {
        return found;
      }
      if (answersTo(row, id) && !row.demoted && !row.cycle && !row.statement) {
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
  effects: StatementEffects,
  adopted: boolean
): { showing: Showing; candidates: Showing[] } {
  const rebuildLink = (
    link: Showing,
    inner: { showing: Showing; candidates: Showing[] } | undefined
  ): { showing: Showing; candidates: Showing[] } => {
    const kept = link.children
      .filter((child) => !effects.applied.has(child))
      .map((child) => rebuildWithoutStatements(child, effects, adopted));
    const taken = (effects.extraChildrenFor.get(link) ?? []).map((child) =>
      rebuildWithoutStatements(child, effects, true)
    );
    const aliasIds = effects.aliasIdsFor.get(link) ?? [];
    const names = [...(effects.namesFor.get(link) ?? []), ...link.names];
    const rebuilt: Showing = {
      ...link,
      target: inner?.showing,
      names,
      spokenBy: [...aliasIds, ...link.spokenBy],
      children: [...kept, ...taken].map((child) => child.showing),
    };
    const moved =
      effects.namesFor.has(link) ||
      (adopted && !link.statement && names.length > 0);
    return {
      showing: rebuilt,
      candidates: [
        ...(moved ? [rebuilt] : []),
        ...(inner?.candidates ?? []),
        ...[...kept, ...taken].flatMap((child) => child.candidates),
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

function applyLayerStatements(
  layer: Showing,
  collected: { statement: Showing; scope: Showing | undefined }[]
): { showing: Showing; candidates: Showing[] } {
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
  // Applied back to front so statements of one diff keep their file order
  // while a later statement's names take priority.
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
    return { showing: layer, candidates: [] };
  }
  return rebuildWithoutStatements(layer, effects, false);
}

type Draft = {
  of: Showing;
  target: Draft | undefined;
  entries: (Draft | { bookmark: Showing })[];
};

/* eslint-disable functional/no-let, functional/immutable-data, @typescript-eslint/no-use-before-define */
// The bookmark walk builds the new tree in place: an immutable append would
// copy every children array per inserted row, O(n²) on wide trees.
function readNames(root: Showing, candidates: Set<Showing>): Showing {
  const index = new Map<ID, Showing>();
  index.set(root.node.id, root);
  eachRow(root, (row) => {
    [row.node.id, ...row.spokenBy].forEach((id) => {
      if (!index.has(id)) {
        index.set(id, row);
      }
    });
  });
  const lists = new Map<
    Showing,
    { before: Showing[]; after: Showing[]; child: Showing[] }
  >();
  const lapsedRows = new Set<Showing>();
  const noted = new Set<Showing>();
  eachRow(root, (row) => {
    if (row.names.length === 0 || !candidates.has(row)) {
      return;
    }
    const found = row.names
      .map((name) => ({
        name,
        anchor: index.get(name.id),
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
    // Copied before its lists unfold — a circle of names would otherwise unfold forever.
    const draft = emitRow(row);
    const befores: Draft["entries"] = [];
    (lists.get(row)?.before ?? []).forEach((early) => unfold(befores, early));
    const afters: Draft["entries"] = [];
    (lists.get(row)?.after ?? []).forEach((late) => unfold(afters, late));
    entries.push(...befores, draft, ...afters);
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

function settleLayer(layer: Showing): Showing {
  const collected: { statement: Showing; scope: Showing | undefined }[] = [];
  collectLayerStatements(layer, undefined, collected);
  const staged =
    collected.length > 0
      ? applyLayerStatements(layer, collected)
      : { showing: layer, candidates: [] };
  const ownNamed: Showing[] = [];
  layerNamedRows(staged.showing, ownNamed);
  const candidates = new Set([...staged.candidates, ...ownNamed]);
  if (candidates.size === 0) {
    return staged.showing;
  }
  return readNames(staged.showing, candidates);
}

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
    undefined
  ).showing;
  return settleLayer(built);
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
