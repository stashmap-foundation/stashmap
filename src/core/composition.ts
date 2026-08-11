import { List } from "immutable";
import { formatPrefixMarkers } from "../documentFormat";
import { EMPTY_NODE_ID } from "./connections";
import type { AddToParentTarget } from "./plan";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  lookupNode,
} from "./graphLookup";
import {
  effectiveText,
  nodeText,
  plainSpans,
  rewordingTargets,
} from "./nodeSpans";

export type ComposedRow = {
  id: ID;
  ref: NodeRef;
  node: GraphNode;
  reader: boolean;
  kind: "placement" | "speaking" | "link" | "own";
  target: ID | undefined;
  chain: ID[];
  text: string;
  relevance: Relevance;
  argument: Argument;
  judgments: { id: ID; relevance: Relevance; argument: Argument }[];
  flags: (
    | "ambiguous-anchor"
    | "cycle"
    | "dangling"
    | "lapsed"
    | "orphan-source"
  )[];
  drift: { frozen: string; current: string } | undefined;
  children: ComposedRow[];
  scope: ID;
  writeParent: ID;
  writtenParent: ID | undefined;
  sourceParent: NodeRef | undefined;
};

export type CompositionResult = {
  root: ComposedRow;
  claims: {
    id: ID;
    kind: ComposedRow["kind"];
    target: ID | undefined;
    relevance: Relevance;
    argument: Argument;
    text: string;
    context: ID;
    parent: ID;
  }[];
  diagnostics: {
    code: string;
    rowId: ID;
    details: { frozen: string; current: string } | undefined;
  }[];
};

type Pending = { rowId: ID; sourceId: SourceId; parentId: ID; order: number };

export type Gesture =
  | {
      kind: "judge";
      row: ComposedRow;
      path: readonly [number, ...ID[]];
      relevance: Relevance;
      argument: Argument;
      spans: InlineSpan[];
    }
  | {
      kind: "move";
      rows: {
        row: ComposedRow;
        sourceParent: ComposedRow | undefined;
        predecessor: ComposedRow | undefined;
        path: readonly [number, ...ID[]];
      }[];
      parent: ComposedRow;
      parentPath: readonly [number, ...ID[]];
      after: ComposedRow | undefined;
    }
  | {
      kind: "reword";
      row: ComposedRow;
      path: readonly [number, ...ID[]];
      spans: InlineSpan[];
    }
  | {
      kind: "place";
      targets: {
        target: AddToParentTarget;
        relevance: Relevance;
        argument: Argument;
      }[];
      parent: ComposedRow;
      at: number | undefined;
      after: ComposedRow | undefined;
    }
  | {
      kind: "dismiss";
      row: ComposedRow;
      path: readonly [number, ...ID[]];
      spans: InlineSpan[];
    };

function rowKind(node: GraphNode): ComposedRow["kind"] {
  const struck = rewordingTargets(node);
  if (node.extraAttrs?.embed === "true" && struck.length > 0) {
    return "speaking";
  }
  if (
    node.spans.length === 1 &&
    node.spans[0].kind === "link" &&
    node.spans[0].struck !== true &&
    node.spans[0].href.startsWith("#")
  ) {
    return node.extraAttrs?.embed === "true" ? "placement" : "link";
  }
  return "own";
}

function rowTargets(node: GraphNode): ID[] {
  if (rowKind(node) === "speaking") {
    return rewordingTargets(node);
  }
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" && span.href.startsWith("#")
    ? [span.href.slice(1)]
    : [];
}

function targetOf(node: GraphNode): ID | undefined {
  return rowTargets(node)[0];
}

function projects(node: GraphNode): boolean {
  const kind = rowKind(node);
  return kind === "placement" || kind === "speaking";
}

function anchored(node: GraphNode): boolean {
  return (
    node.extraAttrs?.front === "true" || node.extraAttrs?.after !== undefined
  );
}

function hasMarker(node: GraphNode): boolean {
  return node.relevance !== undefined || node.argument !== undefined;
}

function frozenText(node: GraphNode): string {
  const kind = rowKind(node);
  if (kind === "speaking") {
    return (
      node.spans.find((span) => span.kind === "link" && span.struck === true)
        ?.text ?? nodeText(node)
    );
  }
  if (kind === "placement" || kind === "link") {
    return node.spans[0].text;
  }
  return nodeText(node);
}

function isReaderRow(resolved: ResolvedNode, rootRef: NodeRef): boolean {
  return (
    resolved.ref.sourceId === rootRef.sourceId &&
    resolved.node.root === rootRef.id
  );
}

function withFlag(
  row: ComposedRow,
  flag: ComposedRow["flags"][number]
): ComposedRow {
  return row.flags.includes(flag)
    ? row
    : { ...row, flags: [...row.flags, flag] };
}

function paths(
  rows: ComposedRow[],
  predicate: (row: ComposedRow) => boolean
): number[][] {
  const walk = (forest: ComposedRow[], prefix: number[]): number[][] =>
    forest.flatMap((row, index) => {
      const path = [...prefix, index];
      return [...(predicate(row) ? [path] : []), ...walk(row.children, path)];
    });
  return walk(rows, []);
}

function at(rows: ComposedRow[], path: number[]): ComposedRow {
  const first = rows[path[0]];
  return path.slice(1).reduce((row, index) => row.children[index], first);
}

function replace(
  rows: ComposedRow[],
  path: number[],
  replacements: ComposedRow[]
): ComposedRow[] {
  const [index, ...rest] = path;
  if (rest.length === 0) {
    return [...rows.slice(0, index), ...replacements, ...rows.slice(index + 1)];
  }
  const row = rows[index];
  return [
    ...rows.slice(0, index),
    { ...row, children: replace(row.children, rest, replacements) },
    ...rows.slice(index + 1),
  ];
}

const BROKEN_FLAGS = ["dangling", "orphan-source", "cycle"];

function matchPath(
  rows: ComposedRow[],
  target: ID
): number[] | "ambiguous" | "none" {
  const immediateExact = rows.flatMap((row, index) =>
    row.id === target ? [[index]] : []
  );
  if (immediateExact.length === 1) {
    return immediateExact[0];
  }
  if (immediateExact.length > 1) {
    return "ambiguous";
  }
  const immediateInherited = rows.flatMap((row, index) =>
    row.chain.includes(target) ? [[index]] : []
  );
  if (immediateInherited.length === 1) {
    return immediateInherited[0];
  }
  if (immediateInherited.length > 1) {
    return "ambiguous";
  }
  const exact = paths(rows, (row) => row.id === target);
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    return "ambiguous";
  }
  const inherited = paths(rows, (row) => row.chain.includes(target));
  if (inherited.length === 1) {
    return inherited[0];
  }
  return inherited.length > 1 ? "ambiguous" : "none";
}

function validAnchorPositions(
  rows: ComposedRow[],
  anchor: ID
): { positions: number[]; ambiguous: boolean } {
  const exact = rows.flatMap((row, index) =>
    row.id === anchor ? [index] : []
  );
  if (exact.length > 0) {
    return { positions: exact, ambiguous: exact.length > 1 };
  }
  const inherited = rows.flatMap((row, index) =>
    row.chain.includes(anchor) &&
    !row.flags.some((flag) => BROKEN_FLAGS.includes(flag))
      ? [index]
      : []
  );
  return { positions: inherited, ambiguous: inherited.length > 1 };
}

function dedupe(values: ID[]): ID[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function dedupeFlags(flags: ComposedRow["flags"]): ComposedRow["flags"] {
  return flags.filter((value, index) => flags.indexOf(value) === index);
}

function isPathPrefix(prefix: number[], path: number[]): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((value, index) => path[index] === value)
  );
}

function followAnchors(root: ComposedRow): ComposedRow {
  const entriesOf = (
    row: ComposedRow,
    prefix: number[],
    hidden: boolean
  ): { path: number[]; row: ComposedRow; hidden: boolean }[] =>
    row.children.flatMap((child, index) => {
      const path = [...prefix, index];
      const childHidden = hidden || child.relevance === "not_relevant";
      return [
        { path, row: child, hidden: childHidden },
        ...entriesOf(child, path, childHidden),
      ];
    });

  const scopePrefix = (forest: ComposedRow[], path: number[]): number[] => {
    const descend = (walk: ComposedRow[], depth: number): number[] => {
      if (depth >= path.length - 1) {
        return [];
      }
      const row = walk[path[depth]];
      if (row.reader && row.target !== undefined) {
        return path.slice(0, depth + 1);
      }
      return descend(row.children, depth + 1);
    };
    return descend(forest, 0);
  };

  const moveEntry = (
    tree: ComposedRow,
    entries: { path: number[]; row: ComposedRow; hidden: boolean }[],
    entry: { path: number[]; row: ComposedRow; hidden: boolean }
  ): ComposedRow | undefined => {
    if (entry.hidden || !entry.row.reader) {
      return undefined;
    }
    const anchor = entry.row.node.extraAttrs?.after;
    if (anchor === undefined) {
      return undefined;
    }
    const scope = scopePrefix(tree.children, entry.path);
    const candidates = entries.filter(
      (candidate) =>
        !candidate.hidden &&
        isPathPrefix(scope, candidate.path) &&
        candidate.path.join(",") !== entry.path.join(",") &&
        !isPathPrefix(entry.path, candidate.path) &&
        !candidate.row.flags.some((flag) => BROKEN_FLAGS.includes(flag)) &&
        (candidate.row.id === anchor || candidate.row.chain.includes(anchor))
    );
    const exact = candidates.filter((candidate) => candidate.row.id === anchor);
    const chosen = exact.length > 0 ? exact : candidates;
    if (chosen.length !== 1) {
      return undefined;
    }
    const anchorPath = chosen[0].path;
    if (
      anchorPath.length === entry.path.length &&
      isPathPrefix(anchorPath.slice(0, -1), entry.path) &&
      entry.path[entry.path.length - 1] ===
        anchorPath[anchorPath.length - 1] + 1
    ) {
      return undefined;
    }
    const without = replace(tree.children, entry.path, []);
    const parent = entry.path.slice(0, -1);
    const shifted = anchorPath.map((value, index) =>
      index === parent.length &&
      isPathPrefix(parent, anchorPath) &&
      anchorPath.length > parent.length &&
      anchorPath[parent.length] > entry.path[entry.path.length - 1]
        ? value - 1
        : value
    );
    const view = {
      ...entry.row,
      flags: entry.row.flags.filter((flag) => flag !== "lapsed"),
    };
    const insertIndex = shifted[shifted.length - 1] + 1;
    if (shifted.length === 1) {
      return {
        ...tree,
        children: [
          ...without.slice(0, insertIndex),
          view,
          ...without.slice(insertIndex),
        ],
      };
    }
    const parentRow = at(without, shifted.slice(0, -1));
    return {
      ...tree,
      children: replace(without, shifted.slice(0, -1), [
        {
          ...parentRow,
          children: [
            ...parentRow.children.slice(0, insertIndex),
            view,
            ...parentRow.children.slice(insertIndex),
          ],
        },
      ]),
    };
  };

  const anchoredCount = entriesOf(root, [], false).filter(
    (entry) =>
      entry.row.reader && entry.row.node.extraAttrs?.after !== undefined
  ).length;
  const bound = globalThis.Math.max(10, 2 * anchoredCount * anchoredCount);

  const rounds = (tree: ComposedRow, round: number): ComposedRow => {
    if (round >= bound) {
      return tree;
    }
    const entries = entriesOf(tree, [], false);
    const moved = entries.reduce<ComposedRow | undefined>(
      (done, entry) => done ?? moveEntry(tree, entries, entry),
      undefined
    );
    return moved ? rounds(moved, round + 1) : tree;
  };
  return rounds(root, 0);
}

function pruneConsumed(root: ComposedRow): ComposedRow {
  const represented = new globalThis.Map<
    ID,
    { chain: ID[]; from: ID | undefined }[]
  >();
  const collectRepresented = (row: ComposedRow, chain: ID[]): void => {
    if (
      row.reader &&
      row.target !== undefined &&
      !row.flags.includes("lapsed")
    ) {
      represented.set(row.target, [
        ...(represented.get(row.target) ?? []),
        { chain, from: row.node.extraAttrs?.from },
      ]);
    }
    const next = row.reader ? [...chain, row.id] : chain;
    row.children.forEach((child) => collectRepresented(child, next));
  };
  collectRepresented(root, []);

  const prune = (row: ComposedRow, chain: ID[]): ComposedRow => {
    const next = row.reader ? [...chain, row.id] : chain;
    return {
      ...row,
      children: row.children
        .filter(
          (child) =>
            child.reader ||
            !(represented.get(child.id) ?? []).some(
              (claim) =>
                claim.chain.every((value, index) => next[index] === value) &&
                (claim.from === undefined || next.includes(claim.from))
            )
        )
        .map((child) => prune(child, next)),
    };
  };
  return prune(root, []);
}

function assignWriteParents(row: ComposedRow, writeParent: ID): ComposedRow {
  const childParent = row.reader ? row.id : writeParent;
  return {
    ...row,
    writeParent,
    children: row.children.map((child) =>
      assignWriteParents(child, childParent)
    ),
  };
}

function collectDiagnostics(
  root: ComposedRow
): CompositionResult["diagnostics"] {
  const walk = (row: ComposedRow): CompositionResult["diagnostics"] => [
    ...row.flags.map((code) => ({ code, rowId: row.id, details: undefined })),
    ...(row.drift
      ? [{ code: "drift", rowId: row.id, details: row.drift }]
      : []),
    ...row.children.flatMap(walk),
  ];
  const seen = new globalThis.Set<string>();
  return walk(root).filter((entry) => {
    const key = `${entry.code}:${entry.rowId}:${entry.details?.frozen ?? ""}:${
      entry.details?.current ?? ""
    }`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function markerText(relevance: Relevance, argument: Argument): string {
  const prefix = formatPrefixMarkers(relevance, argument);
  return prefix === "" ? "" : prefix.replace("(", "{").replace(")", "}");
}

export function composeNote(
  graph: GraphLookup,
  rootRef: NodeRef
): CompositionResult {
  const claimedParent = new globalThis.Map<
    ID,
    { parent: ID; readerPath: ID[] }[]
  >();
  const fileOrder = new globalThis.Map<string, number>();
  const absorbed = new globalThis.Set<ID>();

  const readerNode = (id: ID): ResolvedNode | undefined => {
    const resolved = getNodeInSource(graph, {
      sourceId: rootRef.sourceId,
      id,
    });
    return resolved && resolved.node.root === rootRef.id ? resolved : undefined;
  };

  const resolvable = (id: ID, sourceId: SourceId): boolean =>
    lookupNode(graph, id, sourceId) !== undefined;

  const sourceAncestors = (
    id: ID,
    sourceId: SourceId,
    seen: ID[] = []
  ): ID[] => {
    if (seen.includes(id)) {
      return seen;
    }
    const resolved = lookupNode(graph, id, sourceId);
    const next = [...seen, id];
    return resolved?.node.parent === undefined
      ? next
      : sourceAncestors(resolved.node.parent, resolved.ref.sourceId, next);
  };

  const readerScope = (
    readerPath: ID[],
    target: ID,
    sourceId: SourceId
  ): ID[] => {
    const ancestors = sourceAncestors(target, sourceId);
    return readerPath.reduce<{ ids: ID[]; open: boolean }>(
      (state, id) => {
        if (!state.open) {
          return state;
        }
        const represented = readerNode(id);
        const representedTarget = represented
          ? targetOf(represented.node)
          : undefined;
        return representedTarget !== undefined &&
          ancestors.includes(representedTarget)
          ? { ids: [...state.ids, id], open: true }
          : { ...state, open: false };
      },
      { ids: [], open: true }
    ).ids;
  };

  const childRows = (owner: ResolvedNode): ResolvedNode[] =>
    owner.node.children
      .toArray()
      .filter((id) => id !== EMPTY_NODE_ID)
      .flatMap((id) => {
        const resolved = getNodeInSource(graph, {
          sourceId: owner.ref.sourceId,
          id,
        });
        return resolved ? [resolved] : [];
      });

  const rootResolved = getNodeInSource(graph, rootRef);
  if (!rootResolved) {
    const node: GraphNode = {
      children: List<ID>(),
      id: rootRef.id,
      spans: plainSpans(rootRef.id),
      updated: 0,
      root: rootRef.id,
      relevance: undefined,
    };
    return {
      root: {
        id: rootRef.id,
        ref: rootRef,
        node,
        reader: false,
        kind: "placement",
        target: rootRef.id,
        chain: [rootRef.id],
        text: rootRef.id,
        relevance: undefined,
        argument: undefined,
        judgments: [],
        flags: ["dangling"],
        drift: undefined,
        children: [],
        scope: rootRef.id,
        writeParent: rootRef.id,
        writtenParent: undefined,
        sourceParent: undefined,
      },
      claims: [],
      diagnostics: [],
    };
  }

  const rootProjects = projects(rootResolved.node);
  const rootTarget = targetOf(rootResolved.node);

  const baseEntry =
    rootProjects && rootTarget !== undefined
      ? lookupNode(graph, rootTarget, rootRef.sourceId)
      : undefined;
  const baseRoot = baseEntry
    ? getNodeInSource(graph, {
        sourceId: baseEntry.ref.sourceId,
        id: baseEntry.node.root,
      }) ?? baseEntry
    : undefined;
  const scanAbsorbed = (row: ResolvedNode): void => {
    if (projects(row.node)) {
      rowTargets(row.node).forEach((target) => {
        if (readerNode(target)) {
          absorbed.add(target);
        }
      });
    }
    childRows(row).forEach(scanAbsorbed);
  };
  if (baseRoot) {
    scanAbsorbed(baseRoot);
  }

  const rootScope =
    rootProjects && rootTarget !== undefined
      ? rootTarget
      : rootResolved.node.id;

  const collect = (
    owner: ResolvedNode,
    scope: ID,
    readerPath: ID[]
  ): CompositionResult["claims"] =>
    childRows(owner).flatMap((child, order) => {
      fileOrder.set(`${owner.node.id} ${child.node.id}`, order);
      const kind = rowKind(child.node);
      const target = targetOf(child.node);
      if (
        projects(child.node) &&
        anchored(child.node) &&
        child.node.argument === undefined &&
        target !== undefined &&
        resolvable(target, child.ref.sourceId)
      ) {
        const fromScope = child.node.extraAttrs?.from;
        const claimReaderPath = dedupe([
          ...readerScope(readerPath, target, child.ref.sourceId),
          ...(fromScope !== undefined ? [fromScope] : []),
        ]);
        const existing = claimedParent.get(target) ?? [];
        if (
          !existing.some(
            (claim) =>
              claim.readerPath.join("\0") === claimReaderPath.join("\0")
          )
        ) {
          claimedParent.set(target, [
            ...existing,
            { parent: scope, readerPath: claimReaderPath },
          ]);
        }
      }
      const childScope =
        projects(child.node) && target !== undefined ? target : child.node.id;
      const childReaderPath =
        isReaderRow(child, rootRef) && projects(child.node)
          ? [...readerPath, child.node.id]
          : readerPath;
      return [
        {
          id: child.node.id,
          kind,
          target,
          relevance: child.node.relevance,
          argument: child.node.argument,
          text: nodeText(child.node),
          context: scope,
          parent: owner.node.id,
        },
        ...collect(child, childScope, childReaderPath),
      ];
    });
  const claims = collect(rootResolved, rootScope, []);

  function resolveRow(
    start: ResolvedNode,
    active: ID[],
    scope: ID,
    writtenParent: ID | undefined,
    composeLayerFn: (
      inner: ComposedRow[],
      owner: ResolvedNode,
      active: ID[],
      scope: ID
    ) => [ComposedRow[], Pending[]]
  ): [ComposedRow, Pending[]] {
    const walkChain = (
      current: ResolvedNode,
      visited: ID[]
    ): {
      layers: ResolvedNode[];
      chain: ID[];
      flags: ComposedRow["flags"];
      terminal: ResolvedNode | undefined;
      merged: ResolvedNode | undefined;
    } => {
      if (visited.includes(current.node.id)) {
        return {
          layers: [],
          chain: [current.node.id],
          flags: ["cycle"],
          terminal: undefined,
          merged: undefined,
        };
      }
      const kind = rowKind(current.node);
      if (!projects(current.node)) {
        const linkTarget = targetOf(current.node);
        const dangling =
          kind === "link" &&
          linkTarget !== undefined &&
          !resolvable(linkTarget, current.ref.sourceId);
        return {
          layers: [current],
          chain: [current.node.id],
          flags: dangling ? ["dangling"] : [],
          terminal: current,
          merged: undefined,
        };
      }
      const targets = rowTargets(current.node);
      if (kind === "speaking" && targets.length > 1) {
        return {
          layers: [current],
          chain: [current.node.id],
          flags: [],
          terminal: undefined,
          merged: current,
        };
      }
      const target = targets[0];
      const nextVisited = [...visited, current.node.id];
      if (nextVisited.includes(target)) {
        return {
          layers: [current],
          chain: [current.node.id, target],
          flags: ["cycle"],
          terminal: undefined,
          merged: undefined,
        };
      }
      const next = lookupNode(graph, target, current.ref.sourceId);
      if (!next) {
        return {
          layers: [current],
          chain: [current.node.id, target],
          flags: [kind === "speaking" ? "orphan-source" : "dangling"],
          terminal: undefined,
          merged: undefined,
        };
      }
      const rest = walkChain(next, nextVisited);
      return {
        layers: [current, ...rest.layers],
        chain: [current.node.id, ...rest.chain],
        flags: rest.flags,
        terminal: rest.terminal,
        merged: rest.merged,
      };
    };
    const walk = walkChain(start, active);
    const { layers, terminal, merged } = walk;

    const seenIds = [...active, ...layers.map((layer) => layer.node.id)];
    const startIsReader = isReaderRow(start, rootRef);
    const childScope =
      startIsReader && projects(start.node) ? start.node.id : scope;

    const bonds = merged
      ? rowTargets(merged.node).map((target) => {
          if (seenIds.includes(target)) {
            return {
              chain: [target],
              flags: ["cycle"] as ComposedRow["flags"],
              children: [] as ComposedRow[],
              judgments: [] as ComposedRow["judgments"],
              pending: [] as Pending[],
            };
          }
          const bondSource = lookupNode(graph, target, merged.ref.sourceId);
          if (!bondSource) {
            return {
              chain: [target],
              flags: ["orphan-source"] as ComposedRow["flags"],
              children: [] as ComposedRow[],
              judgments: [] as ComposedRow["judgments"],
              pending: [] as Pending[],
            };
          }
          const activeForBond = dedupe([...active, ...walk.chain]);
          const [bond, bondPending] = resolveRow(
            bondSource,
            activeForBond,
            childScope,
            writtenParent,
            composeLayerFn
          );
          return {
            chain: bond.chain,
            flags: [] as ComposedRow["flags"],
            children: bond.children,
            judgments: bond.judgments,
            pending: bondPending,
          };
        })
      : [];
    const chain = [...walk.chain, ...bonds.flatMap((bond) => bond.chain)];
    const flags = [...walk.flags, ...bonds.flatMap((bond) => bond.flags)];
    const mergedJudgments = bonds.flatMap((bond) => bond.judgments);
    const activeChain = dedupe([...active, ...chain]);

    const composeDelegated = (
      inner: [ComposedRow[], Pending[]],
      delegated: ResolvedNode[]
    ): [ComposedRow[], Pending[]] =>
      [...delegated]
        .reverse()
        .reduce<[ComposedRow[], Pending[]]>(([acc, accPending], layer) => {
          const [next, layerPending] = composeLayerFn(
            acc,
            layer,
            activeChain,
            isReaderRow(layer, rootRef) && projects(layer.node)
              ? layer.node.id
              : scope
          );
          return [next, [...accPending, ...layerPending]];
        }, inner);

    const [children, pending] = (() => {
      if (merged) {
        return composeDelegated(
          [
            bonds.flatMap((bond) => bond.children),
            bonds.flatMap((bond) => bond.pending),
          ],
          layers
        );
      }
      if (terminal) {
        const terminalResults = childRows(terminal).flatMap<
          [ComposedRow, Pending[]]
        >((child) => {
          if (absorbed.has(child.node.id)) {
            return [];
          }
          const destination = (claimedParent.get(child.node.id) ?? [])
            .filter((claim) =>
              claim.readerPath.every((id) => activeChain.includes(id))
            )
            .sort(
              (left, right) => right.readerPath.length - left.readerPath.length
            )[0]?.parent;
          if (destination !== undefined && destination !== terminal.node.id) {
            return [];
          }
          return [
            resolveRow(
              child,
              activeChain,
              childScope,
              isReaderRow(child, rootRef) ? terminal.node.id : undefined,
              composeLayerFn
            ),
          ];
        });
        return composeDelegated(
          [
            terminalResults.map(([row]) => row),
            terminalResults.flatMap(([, childPending]) => childPending),
          ],
          layers.slice(0, -1)
        );
      }
      return composeDelegated([[], []], layers);
    })();

    const speaking = layers.find((layer) => rowKind(layer.node) === "speaking");
    const text = (() => {
      if (speaking) {
        return effectiveText(speaking.node);
      }
      if (terminal) {
        return nodeText(terminal.node);
      }
      return layers.length > 0 ? frozenText(layers[0].node) : start.node.id;
    })();
    const judgments = [
      ...layers
        .filter((layer) => hasMarker(layer.node))
        .map((layer) => ({
          id: layer.node.id,
          relevance: layer.node.relevance,
          argument: layer.node.argument,
        })),
      ...mergedJudgments,
    ];
    const effective = judgments[0];
    const source = layers[0] ?? start;
    const sourceIsReader = isReaderRow(source, rootRef);
    return [
      {
        id: source.node.id,
        ref: source.ref,
        node: source.node,
        reader: sourceIsReader,
        kind: rowKind(source.node),
        target: targetOf(source.node),
        chain,
        text,
        relevance: effective?.relevance,
        argument: effective?.argument,
        judgments,
        flags: dedupeFlags(flags),
        drift: undefined,
        children,
        scope: sourceIsReader && projects(source.node) ? source.node.id : scope,
        writeParent: scope,
        writtenParent: sourceIsReader ? writtenParent : undefined,
        sourceParent:
          !sourceIsReader && source.node.parent !== undefined
            ? { sourceId: source.ref.sourceId, id: source.node.parent }
            : undefined,
      },
      pending,
    ];
  }

  function place(
    claim: ResolvedNode,
    source: ComposedRow,
    active: ID[],
    scope: ID,
    writtenParent: ID,
    composeLayerFn: (
      inner: ComposedRow[],
      owner: ResolvedNode,
      active: ID[],
      scope: ID
    ) => [ComposedRow[], Pending[]]
  ): [ComposedRow, Pending[]] {
    const kind = rowKind(claim.node);
    const target = targetOf(claim.node);
    const claimIsReader = isReaderRow(claim, rootRef);
    const text = kind === "speaking" ? effectiveText(claim.node) : source.text;
    const judgments = [
      ...(hasMarker(claim.node)
        ? [
            {
              id: claim.node.id,
              relevance: claim.node.relevance,
              argument: claim.node.argument,
            },
          ]
        : []),
      ...source.judgments,
    ];
    const effective = judgments[0];
    const [children, pending] = composeLayerFn(
      source.children,
      claim,
      [...active, claim.node.id],
      claimIsReader && projects(claim.node) ? claim.node.id : scope
    );
    const drift =
      kind === "placement" &&
      target !== source.id &&
      frozenText(claim.node) !== source.text
        ? { frozen: frozenText(claim.node), current: source.text }
        : undefined;
    return [
      {
        id: claim.node.id,
        ref: claim.ref,
        node: claim.node,
        reader: claimIsReader,
        kind,
        target,
        chain: [claim.node.id, ...source.chain],
        text,
        relevance: effective?.relevance,
        argument: effective?.argument,
        judgments,
        flags: [...source.flags],
        drift,
        children,
        scope: claimIsReader && projects(claim.node) ? claim.node.id : scope,
        writeParent: scope,
        writtenParent: claimIsReader ? writtenParent : undefined,
        sourceParent: source.sourceParent,
      },
      pending,
    ];
  }

  function composeLayer(
    inner: ComposedRow[],
    owner: ResolvedNode,
    active: ID[],
    scope: ID
  ): [ComposedRow[], Pending[]] {
    const contextId = owner.node.id;
    const layerClaims = childRows(owner).filter(
      (claim) => !absorbed.has(claim.node.id)
    );
    const matches = new globalThis.Map<
      ID,
      number[] | "ambiguous" | "none" | "edge-lapsed"
    >(
      layerClaims.map((claim) => {
        const target = targetOf(claim.node);
        return [
          claim.node.id,
          projects(claim.node) && target !== undefined
            ? matchPath(inner, target)
            : "none",
        ];
      })
    );
    layerClaims.forEach((claim) => {
      const target = targetOf(claim.node);
      if (
        claim.node.argument === undefined ||
        !projects(claim.node) ||
        target === undefined ||
        !resolvable(target, claim.ref.sourceId)
      ) {
        return;
      }
      const match = matches.get(claim.node.id);
      if (globalThis.Array.isArray(match) && match.length === 1) {
        return;
      }
      matches.set(claim.node.id, "edge-lapsed");
    });

    const grouped = new globalThis.Map<string, ResolvedNode[]>();
    layerClaims.forEach((claim) => {
      const match = matches.get(claim.node.id);
      if (globalThis.Array.isArray(match)) {
        const key = match.join(",");
        grouped.set(key, [...(grouped.get(key) ?? []), claim]);
      }
    });
    const extraSources = new globalThis.Map<ID, number[][]>();
    layerClaims.forEach((claim) => {
      const targets = rowTargets(claim.node);
      if (!projects(claim.node) || targets.length <= 1) {
        return;
      }
      const match = matches.get(claim.node.id);
      if (!globalThis.Array.isArray(match)) {
        return;
      }
      targets.slice(1).forEach((target) => {
        const secondary = matchPath(inner, target);
        if (
          globalThis.Array.isArray(secondary) &&
          secondary.join(",") !== match.join(",")
        ) {
          extraSources.set(claim.node.id, [
            ...(extraSources.get(claim.node.id) ?? []),
            secondary,
          ]);
        }
      });
    });

    const views = new globalThis.Map<ID, ComposedRow>();
    const detached = new globalThis.Set<ID>();
    const baseline = new globalThis.Map<ID, number>();

    const groupedPaths = [...grouped.keys()]
      .map((key) => key.split(",").map((value) => parseInt(value, 10)))
      .sort((left, right) => {
        if (left.length !== right.length) {
          return right.length - left.length;
        }
        const divergence = left.findIndex(
          (value, index) => value !== right[index]
        );
        return divergence === -1 ? 0 : right[divergence] - left[divergence];
      });
    const pathState = groupedPaths.reduce<{
      sequence: ComposedRow[];
      pending: Pending[];
      consumed: ID[];
    }>(
      (state, path) => {
        const source = at(state.sequence, path);
        const group = grouped.get(path.join(",")) ?? [];
        const groupState = group.reduce<{
          replacements: ComposedRow[];
          pending: Pending[];
          consumed: ID[];
        }>(
          (acc, claim) => {
            const secondaries = (extraSources.get(claim.node.id) ?? []).map(
              (secondaryPath) => at(inner, secondaryPath)
            );
            const claimSource = secondaries.reduce(
              (sourceAcc, secondary) => ({
                ...sourceAcc,
                children: [...sourceAcc.children, ...secondary.children],
                judgments: [...sourceAcc.judgments, ...secondary.judgments],
                chain: dedupe([...sourceAcc.chain, ...secondary.chain]),
              }),
              source
            );
            const [view, nested] = place(
              claim,
              claimSource,
              active,
              scope,
              contextId,
              composeLayer
            );
            views.set(claim.node.id, view);
            const inline = !anchored(claim.node) || path.length === 1;
            if (!inline) {
              detached.add(claim.node.id);
            }
            if (anchored(claim.node) && path.length === 1) {
              baseline.set(claim.node.id, path[0]);
            }
            return {
              replacements: inline
                ? [...acc.replacements, view]
                : acc.replacements,
              pending: [...acc.pending, ...nested],
              consumed: [
                ...acc.consumed,
                ...secondaries.map((secondary) => secondary.id),
              ],
            };
          },
          { replacements: [], pending: [], consumed: [] }
        );
        return {
          sequence: replace(state.sequence, path, groupState.replacements),
          pending: [...state.pending, ...groupState.pending],
          consumed: [...state.consumed, ...groupState.consumed],
        };
      },
      { sequence: inner, pending: [], consumed: [] }
    );
    const afterConsumed = pathState.consumed.reduce((sequence, consumedId) => {
      const occurrences = paths(
        sequence,
        (row) => row.id === consumedId && !row.reader
      );
      return occurrences.length > 0
        ? replace(sequence, occurrences[0], [])
        : sequence;
    }, pathState.sequence);

    const fileState = layerClaims.reduce<{
      sequence: ComposedRow[];
      tail: ComposedRow[];
      pending: Pending[];
    }>(
      (state, claim, order) => {
        const match = matches.get(claim.node.id);
        const target = targetOf(claim.node);
        if (globalThis.Array.isArray(match)) {
          const view = views.get(claim.node.id);
          return detached.has(claim.node.id) && view
            ? { ...state, sequence: [...state.sequence, view] }
            : state;
        }
        if (match === "edge-lapsed") {
          const [view, nested] = resolveRow(
            claim,
            active,
            scope,
            contextId,
            composeLayer
          );
          const flagged = withFlag(view, "lapsed");
          views.set(claim.node.id, flagged);
          return {
            ...state,
            tail: [...state.tail, flagged],
            pending: [...state.pending, ...nested],
          };
        }
        if (
          projects(claim.node) &&
          !anchored(claim.node) &&
          match === "none" &&
          target !== undefined &&
          resolvable(target, claim.ref.sourceId)
        ) {
          return {
            ...state,
            pending: [
              ...state.pending,
              {
                rowId: claim.node.id,
                sourceId: claim.ref.sourceId,
                parentId: contextId,
                order,
              },
            ],
          };
        }
        const [view, nested] = resolveRow(
          claim,
          active,
          scope,
          contextId,
          composeLayer
        );
        views.set(claim.node.id, view);
        return anchored(claim.node)
          ? {
              ...state,
              sequence: [...state.sequence, view],
              pending: [...state.pending, ...nested],
            }
          : {
              ...state,
              tail: [...state.tail, view],
              pending: [...state.pending, ...nested],
            };
      },
      { sequence: afterConsumed, tail: [], pending: pathState.pending }
    );

    const sequence = layerClaims.reduce((current, claim) => {
      if (!anchored(claim.node) || !views.has(claim.node.id)) {
        return current;
      }
      const currentIndex = current.findIndex((row) => row.id === claim.node.id);
      if (currentIndex === -1) {
        return current;
      }
      const view = current[currentIndex];
      const without = [
        ...current.slice(0, currentIndex),
        ...current.slice(currentIndex + 1),
      ];
      if (claim.node.extraAttrs?.front === "true") {
        return [view, ...without];
      }
      const anchor = claim.node.extraAttrs?.after;
      const { positions, ambiguous } = validAnchorPositions(
        without,
        anchor ?? ""
      );
      if (positions.length === 1) {
        const index = positions[0] + 1;
        return [...without.slice(0, index), view, ...without.slice(index)];
      }
      const flagged = withFlag(view, ambiguous ? "ambiguous-anchor" : "lapsed");
      const index = globalThis.Math.min(
        baseline.get(claim.node.id) ?? without.length,
        without.length
      );
      return [...without.slice(0, index), flagged, ...without.slice(index)];
    }, fileState.sequence);

    return [[...sequence, ...fileState.tail], fileState.pending];
  }

  const [resolvedRoot, rootPending] = resolveRow(
    rootResolved,
    [],
    rootResolved.node.id,
    undefined,
    composeLayer
  );

  const activeAt = (tree: ComposedRow, path: number[]): ID[] => {
    const collectActive = (row: ComposedRow, rest: number[], acc: ID[]): ID[] =>
      rest.length === 0
        ? acc
        : collectActive(row.children[rest[0]], rest.slice(1), [
            ...acc,
            ...row.chain,
          ]);
    return dedupe(collectActive(tree, path, []));
  };

  const scopeAt = (tree: ComposedRow, path: number[]): ID => {
    const descend = (rows: ComposedRow[], rest: number[], scope: ID): ID => {
      if (rest.length === 0) {
        return scope;
      }
      const row = rows[rest[0]];
      return descend(
        row.children,
        rest.slice(1),
        row.reader && projects(row.node) ? row.id : scope
      );
    };
    return descend(
      tree.children,
      path.slice(0, -1),
      tree.reader && projects(tree.node) ? tree.id : rootScope
    );
  };

  const insertPending = (
    tree: ComposedRow,
    item: Pending,
    child: ComposedRow
  ): ComposedRow => {
    const insert = (parent: ComposedRow): [ComposedRow, boolean] => {
      if (parent.id === item.parentId) {
        const position = parent.children.findIndex((sibling) => {
          const siblingOrder = fileOrder.get(`${item.parentId} ${sibling.id}`);
          return siblingOrder !== undefined && siblingOrder > item.order;
        });
        const index = position === -1 ? parent.children.length : position;
        return [
          {
            ...parent,
            children: [
              ...parent.children.slice(0, index),
              child,
              ...parent.children.slice(index),
            ],
          },
          true,
        ];
      }
      const folded = parent.children.reduce<[ComposedRow[], boolean]>(
        ([acc, found], current) => {
          if (found) {
            return [[...acc, current], true];
          }
          const [updated, childFound] = insert(current);
          return [[...acc, updated], childFound];
        },
        [[], false]
      );
      return [{ ...parent, children: folded[0] }, folded[1]];
    };
    const [updated, inserted] = insert(tree);
    return inserted
      ? updated
      : { ...updated, children: [...updated.children, child] };
  };

  const drainQueue = (tree: ComposedRow, queue: Pending[]): ComposedRow => {
    if (queue.length === 0) {
      return tree;
    }
    const [item, ...rest] = queue;
    const claim = getNodeInSource(graph, {
      sourceId: item.sourceId,
      id: item.rowId,
    });
    if (!claim) {
      return drainQueue(tree, rest);
    }
    const target = targetOf(claim.node);
    const match =
      target === undefined ? "none" : matchPath(tree.children, target);
    if (globalThis.Array.isArray(match)) {
      const source = at(tree.children, match);
      const [view, nested] = place(
        claim,
        source,
        activeAt(tree, match),
        scopeAt(tree, match),
        item.parentId,
        composeLayer
      );
      return drainQueue(
        { ...tree, children: replace(tree.children, match, [view]) },
        [...rest, ...nested]
      );
    }
    const parentResolved = getNodeInSource(graph, {
      sourceId: rootRef.sourceId,
      id: item.parentId,
    });
    const [view, nested] = resolveRow(
      claim,
      tree.chain,
      parentResolved && projects(parentResolved.node) ? item.parentId : tree.id,
      item.parentId,
      composeLayer
    );
    return drainQueue(insertPending(tree, item, view), [...rest, ...nested]);
  };

  const root = assignWriteParents(
    pruneConsumed(followAnchors(drainQueue(resolvedRoot, rootPending))),
    rootRef.id
  );

  const scanShapes = (row: ResolvedNode): CompositionResult["diagnostics"] => [
    ...(row.node.extraAttrs?.embed === "true" && !projects(row.node)
      ? [
          {
            code: "invalid-embed-shape",
            rowId: row.node.id,
            details: undefined,
          },
        ]
      : []),
    ...childRows(row).flatMap(scanShapes),
  ];
  const diagnostics = [
    ...collectDiagnostics(root),
    ...scanShapes(rootResolved),
    ...(baseRoot ? scanShapes(baseRoot) : []),
  ];

  return { root, claims, diagnostics };
}

export function treeFromComposition(result: CompositionResult): string {
  const render = (row: ComposedRow, depth: number): string[] => {
    const identity = row.reader ? `id:${row.id}` : `base:${row.id}`;
    const flags = [...row.flags]
      .sort()
      .map((flag) => ` flag:${flag}`)
      .join("");
    return [
      `${"  ".repeat(depth)}${markerText(row.relevance, row.argument)}${
        row.text
      } <!-- ${identity}${flags} -->`,
      ...row.children
        .filter((child) => child.relevance !== "not_relevant")
        .flatMap((child) => render(child, depth + 1)),
    ];
  };
  return `${render(result.root, 0).join("\n")}\n`;
}
