import { GraphLookup, ResolvedNode } from "./core/graphLookup";
import {
  PositionName,
  Showing,
  buildShowingTree,
  chainLinksOf,
  embedTargetOf,
  linesShownThrough,
  positionNamesOf,
} from "./showings";

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
  original: Showing;
  target: Draft | undefined;
  children: (Draft | { bookmark: Showing })[];
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
  const copyOrBookmark = (children: Draft["children"], row: Showing): void => {
    if (noted.has(row)) {
      children.push({ bookmark: row });
      return;
    }
    unfold(children, row);
  };
  const copyChain = (link: Showing | undefined): Draft | undefined => {
    if (!link) {
      return undefined;
    }
    return [...chainLinksOf(link)]
      .reverse()
      .reduce<Draft | undefined>((inner, chainLink) => {
        const draft: Draft = {
          original: chainLink,
          target: inner,
          children: [],
        };
        chainLink.children.forEach((child) =>
          copyOrBookmark(draft.children, child)
        );
        return draft;
      }, undefined);
  };
  const copyRow = (row: Showing): Draft => {
    const draft: Draft = { original: row, target: undefined, children: [] };
    copied.set(row, draft);
    draft.target = copyChain(row.target);
    row.children.forEach((child) => copyOrBookmark(draft.children, child));
    (lists.get(row)?.child ?? []).forEach((child) =>
      unfold(draft.children, child)
    );
    return draft;
  };
  function unfold(children: Draft["children"], row: Showing): void {
    if (copied.has(row)) {
      return;
    }
    // Copied before its lists unfold — a circle of names would otherwise unfold forever.
    const draft = copyRow(row);
    const befores: Draft["children"] = [];
    (lists.get(row)?.before ?? []).forEach((early) => unfold(befores, early));
    const afters: Draft["children"] = [];
    (lists.get(row)?.after ?? []).forEach((late) => unfold(afters, late));
    children.push(...befores, draft, ...afters);
  }
  const rootDraft = copyRow(root);
  const sweepBookmarks = (draft: Draft): void => {
    const chainDrafts = [];
    let link: Draft | undefined = draft;
    while (link) {
      chainDrafts.push(link);
      link = link.target;
    }
    chainDrafts.reverse().forEach((chainDraft) => {
      const drafts = chainDraft.children;
      for (let i = 0; i < drafts.length; i += 1) {
        const entry = drafts[i];
        if ("bookmark" in entry) {
          if (copied.has(entry.bookmark)) {
            drafts.splice(i, 1);
            i -= 1;
          } else {
            lapsedRows.add(entry.bookmark);
            const expansion: Draft["children"] = [];
            unfold(expansion, entry.bookmark);
            drafts.splice(i, 1, ...expansion);
            i -= 1;
          }
        } else {
          sweepBookmarks(entry);
        }
      }
    });
  };
  sweepBookmarks(rootDraft);
  const draftToShowing = (draft: Draft): Showing => {
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
      ...chainDraft.original,
      target: inner,
      lapsed: chainDraft.original.lapsed || lapsedRows.has(chainDraft.original),
      children: chainDraft.children.flatMap((entry) =>
        "bookmark" in entry ? [] : [draftToShowing(entry)]
      ),
    });
    return outer.reduce(
      (inner, chainDraft) => materializeLink(chainDraft, inner),
      materializeLink(terminal, undefined)
    );
  };
  return draftToShowing(rootDraft);
}
/* eslint-enable functional/no-let, functional/immutable-data, @typescript-eslint/no-use-before-define */

export function settleLayer(layer: Showing): Showing {
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
  return settleLayer(buildShowingTree(graph, root, settleLayer));
}
