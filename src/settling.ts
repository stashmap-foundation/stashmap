import {
  List as ImmutableList,
  Map as ImmutableMap,
  Set as ImmutableSet,
} from "immutable";
import { GraphLookup, ResolvedNode } from "./core/graphLookup";
import {
  PositionName,
  Showing,
  buildShowingTree,
  carriesMarker,
  chainLinksOf,
  embedTargetOf,
  linesShownThrough,
  positionNamesOf,
} from "./showings";

function rowsUnder(showing: Showing): Showing[] {
  return [
    ...linesShownThrough(showing.target).map(({ line }) => line),
    ...showing.children,
  ];
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

function layerStatements(
  owner: Showing,
  scope: Showing | undefined
): { statement: Showing; scope: Showing | undefined }[] {
  const rowScope = statementScope(owner, scope);
  return owner.children.flatMap((row) => [
    ...(row.statement && !carriesMarker(row.node)
      ? [{ statement: row, scope: rowScope }]
      : []),
    ...layerStatements(row, rowScope),
  ]);
}

function layerNamedRows(owner: Showing): Showing[] {
  return owner.children.flatMap((row) => [
    ...(!row.statement && row.names.length > 0 ? [row] : []),
    ...layerNamedRows(row),
  ]);
}

function sourceRowsUnder(showing: Showing): Showing[] {
  return [
    ...linesShownThrough(showing.target).map(({ line }) => line),
    ...(embedTargetOf(showing.node) === undefined ? showing.children : []),
  ];
}

function findOccurrence(scope: Showing, id: ID): Showing | undefined {
  const answers = (row: Showing): boolean =>
    chainLinksOf(row).some((link) => link.node.id === id);
  const search = (rows: Showing[]): Showing | undefined =>
    rows.reduce<Showing | undefined>((found, row) => {
      if (found) {
        return found;
      }
      if (answers(row) && !row.statement) {
        return row;
      }
      return search(sourceRowsUnder(row));
    }, undefined);
  return search(linesShownThrough(scope.target).map(({ line }) => line));
}

type Spoken = {
  names: PositionName[];
  answersTo: ID[];
  children: Showing[];
  spokenFor: ID;
  spokenUnder: ID | undefined;
};

function decideStatements(
  collected: { statement: Showing; scope: Showing | undefined }[]
): { applied: ImmutableSet<Showing>; targets: ImmutableMap<Showing, Spoken> } {
  return collected.reduce<{
    applied: ImmutableSet<Showing>;
    targets: ImmutableMap<Showing, Spoken>;
  }>(
    (decisions, { statement, scope }) => {
      const targetId = embedTargetOf(statement.node);
      const target =
        scope !== undefined && targetId !== undefined
          ? findOccurrence(scope, targetId)
          : undefined;
      if (!target) {
        return decisions;
      }
      const spoken = decisions.targets.get(target);
      return {
        applied: decisions.applied.add(statement),
        targets: decisions.targets.set(target, {
          names: [...(spoken?.names ?? []), ...positionNamesOf(statement.node)],
          answersTo: [...(spoken?.answersTo ?? []), statement.node.id],
          children: [...(spoken?.children ?? []), ...statement.children],
          spokenFor: spoken?.spokenFor ?? statement.node.id,
          spokenUnder: spoken?.spokenUnder ?? scope?.node.id,
        }),
      };
    },
    {
      applied: ImmutableSet<Showing>(),
      targets: ImmutableMap<Showing, Spoken>(),
    }
  );
}

function applyDecisions(
  showing: Showing,
  decisions: {
    applied: ImmutableSet<Showing>;
    targets: ImmutableMap<Showing, Spoken>;
  },
  insideMoved: boolean
): { showing: Showing; candidates: Showing[] } {
  const rebuiltRows = (
    rows: Showing[],
    moved: boolean
  ): { rows: Showing[]; candidates: Showing[] } =>
    rows.reduce<{ rows: Showing[]; candidates: Showing[] }>(
      (acc, row) => {
        if (decisions.applied.has(row)) {
          return acc;
        }
        const rebuilt = applyDecisions(row, decisions, moved);
        return {
          rows: [...acc.rows, rebuilt.showing],
          candidates: [...acc.candidates, ...rebuilt.candidates],
        };
      },
      { rows: [], candidates: [] }
    );
  const rebuildLink = (
    link: Showing,
    inner: { showing: Showing; candidates: Showing[] } | undefined
  ): { showing: Showing; candidates: Showing[] } => {
    const spoken = decisions.targets.get(link);
    const kept = rebuiltRows(link.children, insideMoved);
    const fromStatements = rebuiltRows(spoken?.children ?? [], true);
    const names = [...(spoken?.names ?? []), ...link.names];
    const rebuilt: Showing = {
      ...link,
      target: inner?.showing,
      names,
      answersTo: [...(spoken?.answersTo ?? []), ...link.answersTo],
      spokenFor: spoken?.spokenFor ?? link.spokenFor,
      spokenUnder: spoken?.spokenUnder ?? link.spokenUnder,
      children: [...kept.rows, ...fromStatements.rows],
    };
    const candidate =
      spoken !== undefined ||
      (insideMoved && !link.statement && names.length > 0);
    return {
      showing: rebuilt,
      candidates: [
        ...(candidate ? [rebuilt] : []),
        ...(inner?.candidates ?? []),
        ...kept.candidates,
        ...fromStatements.candidates,
      ],
    };
  };
  const [terminal, ...outer] = [...chainLinksOf(showing)].reverse();
  return outer.reduce(
    (inner, link) => rebuildLink(link, inner),
    rebuildLink(terminal, undefined)
  );
}

type ReverseLists = { after: Showing[]; child: Showing[] };

type Anchors = {
  listsOf: ImmutableMap<Showing, ReverseLists>;
  anchored: ImmutableSet<Showing>;
  lapsed: ImmutableSet<Showing>;
  ambiguous: ImmutableSet<Showing>;
};

function readAnchors(root: Showing, candidates: Showing[]): Anchors {
  const admit = (
    found: ImmutableMap<ID, Showing[]>,
    row: Showing
  ): ImmutableMap<ID, Showing[]> =>
    rowsUnder(row).reduce(
      (map, under) => admit(map, under),
      chainLinksOf(row)
        .flatMap((link) => [link.node.id, ...link.answersTo])
        .reduce((map, id) => map.set(id, [...(map.get(id) ?? []), row]), found)
    );
  const occurrences = admit(ImmutableMap<ID, Showing[]>(), root);
  const claims = candidates.reduce<{
    claimOf: ImmutableMap<
      Showing,
      { anchor: Showing; kind: "after" | "parent" }
    >;
    lapsed: ImmutableSet<Showing>;
    ambiguous: ImmutableSet<Showing>;
  }>(
    (acc, row) => {
      const name = row.names.at(0);
      if (name === undefined) {
        return { ...acc, lapsed: acc.lapsed.add(row) };
      }
      const found = (occurrences.get(name.id) ?? []).filter(
        (occurrence) => occurrence !== row
      );
      if (found.length === 0) {
        return { ...acc, lapsed: acc.lapsed.add(row) };
      }
      if (found.length > 1) {
        return { ...acc, ambiguous: acc.ambiguous.add(row) };
      }
      return {
        ...acc,
        claimOf: acc.claimOf.set(row, { anchor: found[0], kind: name.kind }),
      };
    },
    {
      claimOf: ImmutableMap(),
      lapsed: ImmutableSet(),
      ambiguous: ImmutableSet(),
    }
  );
  const onCircle = (row: Showing): boolean => {
    const walk = (current: Showing, path: ImmutableSet<Showing>): boolean => {
      const claim = claims.claimOf.get(current);
      if (!claim) {
        return false;
      }
      if (claim.anchor === row) {
        return true;
      }
      if (path.has(claim.anchor)) {
        return false;
      }
      return walk(claim.anchor, path.add(current));
    };
    return walk(row, ImmutableSet([row]));
  };
  return claims.claimOf.reduce<Anchors>(
    (anchors, claim, row) => {
      if (onCircle(row)) {
        return { ...anchors, lapsed: anchors.lapsed.add(row) };
      }
      const lists = anchors.listsOf.get(claim.anchor) ?? {
        after: [],
        child: [],
      };
      return {
        ...anchors,
        listsOf: anchors.listsOf.set(claim.anchor, {
          after: claim.kind === "after" ? [...lists.after, row] : lists.after,
          child: claim.kind === "parent" ? [...lists.child, row] : lists.child,
        }),
        anchored: anchors.anchored.add(row),
      };
    },
    {
      listsOf: ImmutableMap(),
      anchored: ImmutableSet(),
      lapsed: claims.lapsed,
      ambiguous: claims.ambiguous,
    }
  );
}

function decidePlacements(
  root: Showing,
  anchors: Anchors
): { moved: ImmutableSet<Showing>; parked: ImmutableSet<Showing> } {
  const listRows = (row: Showing): Showing[] => {
    const lists = anchors.listsOf.get(row);
    return lists ? [...lists.after, ...lists.child] : [];
  };
  const walkRow = (
    walk: { copied: ImmutableSet<Showing>; bookmarks: ImmutableList<Showing> },
    row: Showing
  ): { copied: ImmutableSet<Showing>; bookmarks: ImmutableList<Showing> } => {
    if (walk.copied.has(row)) {
      return walk;
    }
    const withLists = listRows(row).reduce(walkRow, {
      ...walk,
      copied: walk.copied.add(row),
    });
    return rowsUnder(row).reduce(
      (state, child) =>
        anchors.anchored.has(child)
          ? { ...state, bookmarks: state.bookmarks.push(child) }
          : walkRow(state, child),
      withLists
    );
  };
  const seeded = listRows(root).reduce(walkRow, {
    copied: ImmutableSet<Showing>([root]),
    bookmarks: ImmutableList<Showing>(),
  });
  const walked = rowsUnder(root).reduce(
    (state, child) =>
      anchors.anchored.has(child)
        ? { ...state, bookmarks: state.bookmarks.push(child) }
        : walkRow(state, child),
    seeded
  );
  const sweep = (state: {
    copied: ImmutableSet<Showing>;
    bookmarks: ImmutableList<Showing>;
    at: number;
    parked: ImmutableSet<Showing>;
  }): ImmutableSet<Showing> => {
    const row = state.bookmarks.get(state.at);
    if (row === undefined) {
      return state.parked;
    }
    if (state.copied.has(row)) {
      return sweep({ ...state, at: state.at + 1 });
    }
    return sweep({
      ...walkRow({ copied: state.copied, bookmarks: state.bookmarks }, row),
      at: state.at + 1,
      parked: state.parked.add(row),
    });
  };
  const parked = sweep({ ...walked, at: 0, parked: ImmutableSet<Showing>() });
  return { moved: anchors.anchored.subtract(parked), parked };
}

function flatEmission(emitted: { row: Showing; behind: Showing[] }): Showing[] {
  return [emitted.row, ...emitted.behind];
}

function applyPlacements(
  root: Showing,
  anchors: Anchors,
  moved: ImmutableSet<Showing>,
  parked: ImmutableSet<Showing>
): Showing {
  const emitRow = (row: Showing): { row: Showing; behind: Showing[] } => {
    const placeRows = (rows: Showing[]): Showing[] =>
      rows.flatMap((member) =>
        moved.has(member) ? [] : flatEmission(emitRow(member))
      );
    const placedHere = (member: Showing): Showing[] =>
      moved.has(member) ? flatEmission(emitRow(member)) : [];
    const lists = anchors.listsOf.get(row);
    const placedChildren = (lists?.child ?? []).flatMap(placedHere);
    const rebuildLink = (
      link: Showing,
      inner: Showing | undefined,
      leadsChildren: boolean
    ): Showing => ({
      ...link,
      target: inner,
      lapsed:
        link.lapsed ||
        (link === row && (parked.has(row) || anchors.lapsed.has(row))),
      ambiguous: link.ambiguous || (link === row && anchors.ambiguous.has(row)),
      children: [
        ...(leadsChildren ? placedChildren : []),
        ...placeRows(link.children),
      ],
    });
    const [terminal, ...outer] = [...chainLinksOf(row)].reverse();
    return {
      row: outer.reduce(
        (inner, link) => rebuildLink(link, inner, false),
        rebuildLink(terminal, undefined, true)
      ),
      behind: (lists?.after ?? []).flatMap(placedHere),
    };
  };
  return emitRow(root).row;
}

function readNames(root: Showing, candidates: Showing[]): Showing {
  if (candidates.length === 0) {
    return root;
  }
  const anchors = readAnchors(root, candidates);
  const { moved, parked } = decidePlacements(root, anchors);
  return applyPlacements(root, anchors, moved, parked);
}

function layerLineOrder(layer: Showing): ImmutableMap<ID, number> {
  const lines = (owner: Showing): Showing[] =>
    owner.children.flatMap((row) => [row, ...lines(row)]);
  return ImmutableMap(
    lines(layer).map((row, index) => [row.node.id, index] as const)
  );
}

function settleLayer(layer: Showing): {
  showing: Showing;
  spokenIds: ImmutableSet<ID>;
} {
  const decisions = decideStatements(layerStatements(layer, undefined));
  const staged = decisions.applied.isEmpty()
    ? { showing: layer, candidates: [] }
    : applyDecisions(layer, decisions, false);
  const lineOrder = layerLineOrder(layer);
  const ordinalOf = (row: Showing): number =>
    lineOrder.get(row.spokenFor ?? row.node.id) ?? Number.MAX_SAFE_INTEGER;
  const candidates = [
    ...staged.candidates,
    ...layerNamedRows(staged.showing),
  ].sort((left, right) => ordinalOf(left) - ordinalOf(right));
  return {
    showing: readNames(staged.showing, candidates),
    spokenIds: ImmutableSet(
      decisions.applied.toArray().map((statement) => statement.node.id)
    ),
  };
}

function settleMounts(showing: Showing): Showing {
  return {
    ...showing,
    target: showing.target
      ? settleLayer(settleMounts(showing.target)).showing
      : undefined,
    children: showing.children.map(settleMounts),
  };
}

function keepSpeech(showing: Showing, kept: ImmutableSet<ID>): Showing {
  const speaks = showing.spokenFor !== undefined && kept.has(showing.spokenFor);
  return {
    ...showing,
    spokenFor: speaks ? showing.spokenFor : undefined,
    spokenUnder: speaks ? showing.spokenUnder : undefined,
    target: showing.target ? keepSpeech(showing.target, kept) : undefined,
    children: showing.children.map((child) => keepSpeech(child, kept)),
  };
}

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  const settled = settleLayer(settleMounts(buildShowingTree(graph, root)));
  return keepSpeech(settled.showing, settled.spokenIds);
}
