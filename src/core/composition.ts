/* eslint-disable @typescript-eslint/no-use-before-define */
import { List } from "immutable";
import { EMPTY_NODE_ID } from "./connections";
import { effectiveText, nodeText, plainSpans } from "./nodeSpans";
import { formatPrefixMarkers } from "../documentFormat";
import { GraphLookup, ResolvedNode, lookupNode } from "./graphLookup";

export type ComposedJudgment = {
  id: ID;
  relevance: Relevance;
  argument: Argument;
};

export type ComposedFlag =
  | "ambiguous-anchor"
  | "cycle"
  | "dangling"
  | "lapsed"
  | "orphan-source";

export type ComposedRowKind = "placement" | "speaking" | "link" | "own";

export type ComposedRow = {
  id: ID;
  ref: NodeRef;
  node: GraphNode;
  reader: boolean;
  kind: ComposedRowKind;
  target: ID | undefined;
  chain: ID[];
  text: string;
  relevance: Relevance;
  argument: Argument;
  judgments: ComposedJudgment[];
  flags: ComposedFlag[];
  drift: { frozen: string; current: string } | undefined;
  occurrence: ID | undefined;
  children: ComposedRow[];
};

export type ComposedClaimRecord = {
  id: ID;
  kind: ComposedRowKind;
  target: ID | undefined;
  relevance: Relevance;
  argument: Argument;
  text: string;
  context: ID;
  parent: ID;
};

export type CompositionResult = {
  root: ComposedRow;
  claims: ComposedClaimRecord[];
  diagnostics: { code: string; rowId: ID }[];
};

type Claim = {
  row: ResolvedNode;
  kind: ComposedRowKind;
  targets: ID[];
  anchored: boolean;
};

type Pending = {
  claim: Claim;
  contextId: ID;
  order: number;
};

type Composed = {
  row: ComposedRow;
  pending: Pending[];
};

type ComposedLayer = {
  sequence: ComposedRow[];
  pending: Pending[];
};

function struckTargets(node: GraphNode): ID[] {
  return node.spans.flatMap((span) =>
    span.kind === "link" && span.struck === true && span.href.startsWith("#")
      ? [span.href.slice(1)]
      : []
  );
}

function isAnchored(node: GraphNode): boolean {
  return (
    node.extraAttrs?.after !== undefined || node.extraAttrs?.front === "true"
  );
}

function hasMarker(node: GraphNode): boolean {
  return node.relevance !== undefined || node.argument !== undefined;
}

function frozenLabel(node: GraphNode): string {
  const struck = node.spans.find(
    (span) => span.kind === "link" && span.struck === true
  );
  if (struck) {
    return struck.text;
  }
  const link = node.spans.find((span) => span.kind === "link");
  return link ? link.text : nodeText(node);
}

function claimOf(resolved: ResolvedNode): Claim {
  const { node } = resolved;
  const embedded = node.extraAttrs?.embed === "true";
  const struck = struckTargets(node);
  const anchored = isAnchored(node);
  if (embedded && struck.length > 0) {
    return { row: resolved, kind: "speaking", targets: struck, anchored };
  }
  const soleLink =
    node.spans.length === 1 &&
    node.spans[0].kind === "link" &&
    node.spans[0].struck !== true &&
    node.spans[0].href.startsWith("#")
      ? node.spans[0].href.slice(1)
      : undefined;
  if (soleLink !== undefined) {
    return {
      row: resolved,
      kind: embedded ? "placement" : "link",
      targets: [soleLink],
      anchored,
    };
  }
  return { row: resolved, kind: "own", targets: [], anchored };
}

function projects(claim: Claim): boolean {
  return claim.kind === "placement" || claim.kind === "speaking";
}

function claimTarget(claim: Claim): ID | undefined {
  return claim.targets[0];
}

function comparePaths(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  const firstDiff = left.findIndex((value, index) => value !== right[index]);
  return firstDiff === -1 ? 0 : left[firstDiff] - right[firstDiff];
}

function pathsOf(
  forest: ComposedRow[],
  predicate: (row: ComposedRow) => boolean,
  prefix: number[] = []
): number[][] {
  return forest.flatMap((row, index) => {
    const path = [...prefix, index];
    return [
      ...(predicate(row) ? [path] : []),
      ...pathsOf(row.children, predicate, path),
    ];
  });
}

function rowAt(forest: ComposedRow[], path: number[]): ComposedRow {
  return path
    .slice(1)
    .reduce((row, index) => row.children[index], forest[path[0]]);
}

function replaceAt(
  forest: ComposedRow[],
  path: number[],
  replacement: ComposedRow[]
): ComposedRow[] {
  const [index, ...rest] = path;
  if (rest.length === 0) {
    return [
      ...forest.slice(0, index),
      ...replacement,
      ...forest.slice(index + 1),
    ];
  }
  const row = forest[index];
  return [
    ...forest.slice(0, index),
    { ...row, children: replaceAt(row.children, rest, replacement) },
    ...forest.slice(index + 1),
  ];
}

type MatchStatus = "match" | "ambiguous" | "none" | "edge-lapsed";

type Match = { status: MatchStatus; path: number[] | undefined };

function matchPath(forest: ComposedRow[], target: ID): Match {
  const candidates: ((row: ComposedRow) => boolean)[] = [
    (row) => row.id === target,
    (row) => row.chain.includes(target),
  ];
  const immediate = candidates
    .map((predicate) =>
      forest.flatMap((row, index) => (predicate(row) ? [[index]] : []))
    )
    .find((found) => found.length > 0);
  const deep = immediate
    ? undefined
    : candidates
        .map((predicate) => pathsOf(forest, predicate))
        .find((found) => found.length > 0);
  const found = immediate ?? deep;
  if (!found || found.length === 0) {
    return { status: "none", path: undefined };
  }
  if (found.length > 1) {
    return { status: "ambiguous", path: undefined };
  }
  return { status: "match", path: found[0] };
}

const DEGRADED_FLAGS: ComposedFlag[] = ["dangling", "orphan-source", "cycle"];

function validAnchorPositions(
  sequence: ComposedRow[],
  anchor: ID
): { positions: number[]; ambiguous: boolean } {
  const exact = sequence.flatMap((row, index) =>
    row.id === anchor ? [index] : []
  );
  if (exact.length > 0) {
    return { positions: exact, ambiguous: exact.length > 1 };
  }
  const inherited = sequence.flatMap((row, index) =>
    row.chain.includes(anchor) &&
    !row.flags.some((flag) => DEGRADED_FLAGS.includes(flag))
      ? [index]
      : []
  );
  return { positions: inherited, ambiguous: inherited.length > 1 };
}

function withFlags(row: ComposedRow, ...codes: ComposedFlag[]): ComposedRow {
  return {
    ...row,
    flags: [...new globalThis.Set([...row.flags, ...codes])],
  };
}

function effectiveMarker(judgments: ComposedJudgment[]): {
  relevance: Relevance;
  argument: Argument;
} {
  return {
    relevance: judgments[0]?.relevance,
    argument: judgments[0]?.argument,
  };
}

function ownJudgment(node: GraphNode): ComposedJudgment[] {
  return hasMarker(node)
    ? [{ id: node.id, relevance: node.relevance, argument: node.argument }]
    : [];
}

function dedupIds(ids: ID[]): ID[] {
  return [...new globalThis.Set(ids)];
}

export function composeNote(
  graph: GraphLookup,
  rootRef: NodeRef
): CompositionResult {
  const readerRootId = rootRef.id;
  const readerSourceId = rootRef.sourceId;

  function find(id: ID, contextSourceId: SourceId): ResolvedNode | undefined {
    return lookupNode(graph, id, contextSourceId);
  }

  function isReader(resolved: ResolvedNode): boolean {
    return (
      resolved.node.root === readerRootId &&
      resolved.ref.sourceId === readerSourceId
    );
  }

  function childClaims(row: ResolvedNode): Claim[] {
    return row.node.children
      .toArray()
      .filter((childId) => childId !== EMPTY_NODE_ID)
      .flatMap((childId) => {
        const child = find(childId, row.ref.sourceId);
        return child ? [claimOf(child)] : [];
      });
  }

  const claimedParent = new globalThis.Map<ID, ID>();
  const fileOrder = new globalThis.Map<string, number>();

  function fileOrderKey(parentId: ID, childId: ID): string {
    return `${parentId} ${childId}`;
  }

  function collect(row: ResolvedNode, scope: ID): ComposedClaimRecord[] {
    return row.node.children
      .toArray()
      .filter((childId) => childId !== EMPTY_NODE_ID)
      .flatMap((childId, order) => {
        const child = find(childId, row.ref.sourceId);
        if (!child || !isReader(child)) {
          return [];
        }
        const claim = claimOf(child);
        fileOrder.set(fileOrderKey(row.node.id, child.node.id), order);
        const target = claimTarget(claim);
        if (
          projects(claim) &&
          claim.anchored &&
          target !== undefined &&
          find(target, child.ref.sourceId) !== undefined &&
          !claimedParent.has(target)
        ) {
          claimedParent.set(target, scope);
        }
        const childScope =
          projects(claim) && target !== undefined ? target : child.node.id;
        return [
          {
            id: child.node.id,
            kind: claim.kind,
            target,
            relevance: child.node.relevance,
            argument: child.node.argument,
            text: nodeText(child.node),
            context: scope,
            parent: row.node.id,
          },
          ...collect(child, childScope),
        ];
      });
  }

  function makeRow(
    source: ResolvedNode,
    input: Pick<
      ComposedRow,
      | "kind"
      | "target"
      | "chain"
      | "text"
      | "judgments"
      | "flags"
      | "children"
      | "drift"
      | "occurrence"
    >
  ): ComposedRow {
    return {
      id: source.node.id,
      ref: source.ref,
      node: source.node,
      reader: isReader(source),
      ...input,
      ...effectiveMarker(input.judgments),
    };
  }

  function place(claim: Claim, source: ComposedRow, active: ID[]): Composed {
    const text =
      claim.kind === "speaking" ? effectiveText(claim.row.node) : source.text;
    const judgments = [...ownJudgment(claim.row.node), ...source.judgments];
    const layer = composeLayer(
      source.children,
      childClaims(claim.row),
      [...active, claim.row.node.id],
      claim.row.node.id
    );
    const target = claimTarget(claim);
    const drift =
      claim.kind === "placement" &&
      target !== source.id &&
      frozenLabel(claim.row.node) !== source.text
        ? { frozen: frozenLabel(claim.row.node), current: source.text }
        : undefined;
    return {
      row: makeRow(claim.row, {
        kind: claim.kind,
        target,
        chain: [claim.row.node.id, ...source.chain],
        text,
        judgments,
        flags: source.flags,
        children: layer.sequence,
        drift,
        occurrence:
          !source.reader && source.id !== claim.row.node.id
            ? source.id
            : source.occurrence,
      }),
      pending: layer.pending,
    };
  }

  function composeLayer(
    inner: ComposedRow[],
    claims: Claim[],
    active: ID[],
    contextId: ID
  ): ComposedLayer {
    const matches = new globalThis.Map<ID, Match>(
      claims.map((claim) => {
        const target = claimTarget(claim);
        const match =
          projects(claim) && target !== undefined
            ? matchPath(inner, target)
            : { status: "none" as MatchStatus, path: undefined };
        const evidenceLapsed =
          claim.row.node.argument !== undefined &&
          projects(claim) &&
          target !== undefined &&
          find(target, claim.row.ref.sourceId) !== undefined &&
          !(
            match.status === "match" &&
            match.path !== undefined &&
            match.path.length === 1
          );
        return [
          claim.row.node.id,
          evidenceLapsed
            ? { status: "edge-lapsed" as MatchStatus, path: undefined }
            : match,
        ];
      })
    );

    const grouped = new globalThis.Map<
      string,
      { path: number[]; claims: Claim[] }
    >();
    claims.forEach((claim) => {
      const match = matches.get(claim.row.node.id);
      if (match?.status === "match" && match.path !== undefined) {
        const key = match.path.join(",");
        const existing = grouped.get(key);
        grouped.set(key, {
          path: match.path,
          claims: [...(existing?.claims ?? []), claim],
        });
      }
    });

    const extraSources = new globalThis.Map<ID, number[][]>();
    claims.forEach((claim) => {
      if (!projects(claim) || claim.targets.length <= 1) {
        return;
      }
      const match = matches.get(claim.row.node.id);
      if (match?.status !== "match" || match.path === undefined) {
        return;
      }
      claim.targets.slice(1).forEach((target) => {
        const secondary = matchPath(inner, target);
        if (
          secondary.status === "match" &&
          secondary.path !== undefined &&
          secondary.path.join(",") !== match.path?.join(",")
        ) {
          extraSources.set(claim.row.node.id, [
            ...(extraSources.get(claim.row.node.id) ?? []),
            secondary.path,
          ]);
        }
      });
    });

    const views = new globalThis.Map<ID, ComposedRow>();
    const detached = new globalThis.Set<ID>();
    const baseline = new globalThis.Map<ID, number>();

    const substituted = [...grouped.values()]
      .sort((left, right) => -comparePaths(left.path, right.path))
      .reduce<{ sequence: ComposedRow[]; pending: Pending[]; consumed: ID[] }>(
        (acc, group) => {
          const source = rowAt(acc.sequence, group.path);
          const placedGroup = group.claims.reduce<{
            replacements: ComposedRow[];
            pending: Pending[];
            consumed: ID[];
          }>(
            (groupAcc, claim) => {
              const withSecondaries = (
                extraSources.get(claim.row.node.id) ?? []
              ).reduce(
                (sourceAcc, secondaryPath) => {
                  const secondary = rowAt(inner, secondaryPath);
                  return {
                    source: {
                      ...sourceAcc.source,
                      children: [
                        ...sourceAcc.source.children,
                        ...secondary.children,
                      ],
                      judgments: [
                        ...sourceAcc.source.judgments,
                        ...secondary.judgments,
                      ],
                      chain: dedupIds([
                        ...sourceAcc.source.chain,
                        ...secondary.chain,
                      ]),
                    },
                    consumed: [...sourceAcc.consumed, secondary.id],
                  };
                },
                { source, consumed: [] as ID[] }
              );
              const placed = place(claim, withSecondaries.source, active);
              views.set(claim.row.node.id, placed.row);
              if (claim.anchored && group.path.length === 1) {
                baseline.set(claim.row.node.id, group.path[0]);
              }
              const keepInPlace = !claim.anchored || group.path.length === 1;
              if (!keepInPlace) {
                detached.add(claim.row.node.id);
              }
              return {
                replacements: keepInPlace
                  ? [...groupAcc.replacements, placed.row]
                  : groupAcc.replacements,
                pending: [...groupAcc.pending, ...placed.pending],
                consumed: [...groupAcc.consumed, ...withSecondaries.consumed],
              };
            },
            { replacements: [], pending: [], consumed: [] }
          );
          return {
            sequence: replaceAt(
              acc.sequence,
              group.path,
              placedGroup.replacements
            ),
            pending: [...acc.pending, ...placedGroup.pending],
            consumed: [...acc.consumed, ...placedGroup.consumed],
          };
        },
        { sequence: inner, pending: [], consumed: [] }
      );

    const afterConsumed = substituted.consumed.reduce(
      (sequence, consumedId) => {
        const occurrences = pathsOf(
          sequence,
          (row) => row.id === consumedId && !row.reader
        );
        return occurrences.length > 0
          ? replaceAt(sequence, occurrences[0], [])
          : sequence;
      },
      substituted.sequence
    );

    const emitted = claims.reduce<{
      sequence: ComposedRow[];
      tail: ComposedRow[];
      pending: Pending[];
    }>(
      (acc, claim, order) => {
        const match = matches.get(claim.row.node.id);
        if (match?.status === "match" && match.path !== undefined) {
          if (detached.has(claim.row.node.id)) {
            const view = views.get(claim.row.node.id);
            return view ? { ...acc, sequence: [...acc.sequence, view] } : acc;
          }
          return acc;
        }
        if (match?.status === "edge-lapsed") {
          const resolved = resolve(claim.row, active);
          const view = withFlags(resolved.row, "lapsed");
          views.set(claim.row.node.id, view);
          return {
            ...acc,
            tail: [...acc.tail, view],
            pending: [...acc.pending, ...resolved.pending],
          };
        }
        const target = claimTarget(claim);
        if (
          projects(claim) &&
          !claim.anchored &&
          match?.status === "none" &&
          target !== undefined &&
          find(target, claim.row.ref.sourceId) !== undefined
        ) {
          return {
            ...acc,
            pending: [...acc.pending, { claim, contextId, order }],
          };
        }
        const resolved = resolve(claim.row, active);
        views.set(claim.row.node.id, resolved.row);
        return {
          ...acc,
          ...(claim.anchored
            ? { sequence: [...acc.sequence, resolved.row] }
            : { tail: [...acc.tail, resolved.row] }),
          pending: [...acc.pending, ...resolved.pending],
        };
      },
      { sequence: afterConsumed, tail: [], pending: [] }
    );

    const anchoredSequence = claims.reduce((sequence, claim) => {
      if (!claim.anchored || !views.has(claim.row.node.id)) {
        return sequence;
      }
      const current = sequence.findIndex((row) => row.id === claim.row.node.id);
      if (current === -1) {
        return sequence;
      }
      const view = sequence[current];
      const without = [
        ...sequence.slice(0, current),
        ...sequence.slice(current + 1),
      ];
      if (claim.row.node.extraAttrs?.front === "true") {
        return [view, ...without];
      }
      const anchor = claim.row.node.extraAttrs?.after ?? "";
      const { positions, ambiguous } = validAnchorPositions(without, anchor);
      if (positions.length === 1) {
        const index = positions[0] + 1;
        return [...without.slice(0, index), view, ...without.slice(index)];
      }
      const code: ComposedFlag = ambiguous ? "ambiguous-anchor" : "lapsed";
      const flagged = withFlags(view, code);
      const index = Math.min(
        baseline.get(claim.row.node.id) ?? without.length,
        without.length
      );
      return [...without.slice(0, index), flagged, ...without.slice(index)];
    }, emitted.sequence);

    return {
      sequence: [...anchoredSequence, ...emitted.tail],
      pending: [...substituted.pending, ...emitted.pending],
    };
  }

  function danglingStub(id: ID): ComposedRow {
    const node: GraphNode = {
      children: List<ID>(),
      id,
      spans: plainSpans(id),
      updated: 0,
      root: id,
      relevance: undefined,
    };
    return makeRow(
      { ref: { sourceId: readerSourceId, id }, node },
      {
        kind: "placement",
        target: id,
        chain: [id],
        text: id,
        judgments: [],
        flags: ["dangling"],
        children: [],
        drift: undefined,
        occurrence: undefined,
      }
    );
  }

  type ChainWalk = {
    layers: { row: ResolvedNode; claim: Claim }[];
    chain: ID[];
    flags: ComposedFlag[];
    terminal: ResolvedNode | undefined;
    merged: Claim | undefined;
  };

  function walkChain(
    current: ResolvedNode,
    seen: globalThis.Set<ID>
  ): ChainWalk {
    if (seen.has(current.node.id)) {
      return {
        layers: [],
        chain: [current.node.id],
        flags: ["cycle"],
        terminal: undefined,
        merged: undefined,
      };
    }
    seen.add(current.node.id);
    const claim = claimOf(current);
    const layer = { row: current, claim };
    if (!projects(claim)) {
      const target = claimTarget(claim);
      const dangling =
        claim.kind === "link" &&
        target !== undefined &&
        find(target, current.ref.sourceId) === undefined;
      return {
        layers: [layer],
        chain: [current.node.id],
        flags: dangling ? ["dangling"] : [],
        terminal: current,
        merged: undefined,
      };
    }
    if (claim.kind === "speaking" && claim.targets.length > 1) {
      return {
        layers: [layer],
        chain: [current.node.id],
        flags: [],
        terminal: undefined,
        merged: claim,
      };
    }
    const target = claimTarget(claim);
    if (target === undefined) {
      throw new Error(`projecting row without target: ${current.node.id}`);
    }
    if (seen.has(target)) {
      return {
        layers: [layer],
        chain: [current.node.id, target],
        flags: ["cycle"],
        terminal: undefined,
        merged: undefined,
      };
    }
    const next = find(target, current.ref.sourceId);
    if (!next) {
      return {
        layers: [layer],
        chain: [current.node.id, target],
        flags: [claim.kind === "speaking" ? "orphan-source" : "dangling"],
        terminal: undefined,
        merged: undefined,
      };
    }
    const rest = walkChain(next, seen);
    return {
      layers: [layer, ...rest.layers],
      chain: [current.node.id, ...rest.chain],
      flags: rest.flags,
      terminal: rest.terminal,
      merged: rest.merged,
    };
  }

  type ResolvedBase = {
    children: ComposedRow[];
    delegated: { row: ResolvedNode; claim: Claim }[];
    chain: ID[];
    flags: ComposedFlag[];
    mergedJudgments: ComposedJudgment[];
    pending: Pending[];
  };

  function resolveBase(
    walk: ChainWalk,
    seen: globalThis.Set<ID>,
    activeChain: ID[]
  ): ResolvedBase {
    if (walk.merged) {
      const { merged } = walk;
      const bonds = merged.targets.reduce<{
        children: ComposedRow[];
        chain: ID[];
        flags: ComposedFlag[];
        judgments: ComposedJudgment[];
        pending: Pending[];
      }>(
        (acc, target) => {
          if (seen.has(target)) {
            return {
              ...acc,
              chain: [...acc.chain, target],
              flags: [...acc.flags, "cycle"],
            };
          }
          const bondSource = find(target, merged.row.ref.sourceId);
          if (!bondSource) {
            return {
              ...acc,
              chain: [...acc.chain, target],
              flags: [...acc.flags, "orphan-source"],
            };
          }
          const bond = resolve(bondSource, activeChain);
          return {
            children: [...acc.children, ...bond.row.children],
            chain: [...acc.chain, ...bond.row.chain],
            flags: acc.flags,
            judgments: [...acc.judgments, ...bond.row.judgments],
            pending: [...acc.pending, ...bond.pending],
          };
        },
        { children: [], chain: [], flags: [], judgments: [], pending: [] }
      );
      return {
        children: bonds.children,
        delegated: walk.layers,
        chain: [...walk.chain, ...bonds.chain],
        flags: [...walk.flags, ...bonds.flags],
        mergedJudgments: bonds.judgments,
        pending: bonds.pending,
      };
    }
    if (walk.terminal) {
      const { terminal } = walk;
      const resolvedChildren = terminal.node.children
        .toArray()
        .filter((childId) => childId !== EMPTY_NODE_ID)
        .reduce<{ children: ComposedRow[]; pending: Pending[] }>(
          (acc, childId) => {
            const destination = claimedParent.get(childId);
            if (destination !== undefined && destination !== terminal.node.id) {
              return acc;
            }
            const child = find(childId, terminal.ref.sourceId);
            if (!child) {
              return acc;
            }
            const resolved = resolve(child, activeChain);
            return {
              children: [...acc.children, resolved.row],
              pending: [...acc.pending, ...resolved.pending],
            };
          },
          { children: [], pending: [] }
        );
      return {
        children: resolvedChildren.children,
        delegated: walk.layers.slice(0, -1),
        chain: walk.chain,
        flags: walk.flags,
        mergedJudgments: [],
        pending: resolvedChildren.pending,
      };
    }
    return {
      children: [],
      delegated: walk.layers,
      chain: walk.chain,
      flags: walk.flags,
      mergedJudgments: [],
      pending: [],
    };
  }

  function resolve(row: ResolvedNode, active: ID[]): Composed {
    const seen = new globalThis.Set<ID>(active);
    const walk = walkChain(row, seen);
    const activeChain = dedupIds([...active, ...walk.chain]);
    const base = resolveBase(walk, seen, activeChain);

    const layered = [...base.delegated].reverse().reduce<{
      children: ComposedRow[];
      pending: Pending[];
    }>(
      (acc, layer) => {
        const layerResult = composeLayer(
          acc.children,
          childClaims(layer.row),
          activeChain,
          layer.row.node.id
        );
        return {
          children: layerResult.sequence,
          pending: [...acc.pending, ...layerResult.pending],
        };
      },
      { children: base.children, pending: base.pending }
    );

    const speaking = walk.layers.find(
      (layer) => layer.claim.kind === "speaking"
    );
    const text = ((): string => {
      if (speaking) {
        return effectiveText(speaking.row.node);
      }
      if (walk.terminal) {
        return nodeText(walk.terminal.node);
      }
      return walk.layers.length > 0
        ? frozenLabel(walk.layers[0].row.node)
        : row.node.id;
    })();

    const judgments = [
      ...walk.layers.flatMap((layer) => ownJudgment(layer.row.node)),
      ...base.mergedJudgments,
    ];

    const first = walk.layers[0] ?? { row, claim: claimOf(row) };
    return {
      row: makeRow(first.row, {
        kind: first.claim.kind,
        target: claimTarget(first.claim),
        chain: dedupIds(base.chain),
        text,
        judgments,
        flags: [...new globalThis.Set(base.flags)],
        children: layered.children,
        drift: undefined,
        occurrence: undefined,
      }),
      pending: layered.pending,
    };
  }

  function activeAt(root: ComposedRow, path: number[]): ID[] {
    const walked = path.slice(0, -1).reduce<{ row: ComposedRow; active: ID[] }>(
      (acc, index) => {
        const next = acc.row.children[index];
        return { row: next, active: [...acc.active, ...next.chain] };
      },
      { row: root, active: [...root.chain] }
    );
    return dedupIds(walked.active);
  }

  function insertPending(
    root: ComposedRow,
    item: Pending,
    child: ComposedRow
  ): ComposedRow {
    function insert(parent: ComposedRow): {
      row: ComposedRow;
      inserted: boolean;
    } {
      if (parent.id === item.contextId) {
        const position = parent.children.findIndex((sibling) => {
          const siblingOrder = fileOrder.get(
            fileOrderKey(item.contextId, sibling.id)
          );
          return siblingOrder !== undefined && siblingOrder > item.order;
        });
        const index = position === -1 ? parent.children.length : position;
        return {
          row: {
            ...parent,
            children: [
              ...parent.children.slice(0, index),
              child,
              ...parent.children.slice(index),
            ],
          },
          inserted: true,
        };
      }
      return parent.children.reduce<{ row: ComposedRow; inserted: boolean }>(
        (acc, current, index) => {
          if (acc.inserted) {
            return acc;
          }
          const result = insert(current);
          if (!result.inserted) {
            return acc;
          }
          return {
            row: {
              ...acc.row,
              children: [
                ...acc.row.children.slice(0, index),
                result.row,
                ...acc.row.children.slice(index + 1),
              ],
            },
            inserted: true,
          };
        },
        { row: parent, inserted: false }
      );
    }

    const result = insert(root);
    if (result.inserted) {
      return result.row;
    }
    return { ...result.row, children: [...result.row.children, child] };
  }

  function drainPending(root: ComposedRow, queue: Pending[]): ComposedRow {
    if (queue.length === 0) {
      return root;
    }
    const [item, ...rest] = queue;
    const target = claimTarget(item.claim);
    const match = matchPath(root.children, target ?? "");
    if (match.status === "match" && match.path !== undefined) {
      const source = rowAt(root.children, match.path);
      const placed = place(item.claim, source, activeAt(root, match.path));
      return drainPending(
        {
          ...root,
          children: replaceAt(root.children, match.path, [placed.row]),
        },
        [...rest, ...placed.pending]
      );
    }
    const resolved = resolve(item.claim.row, root.chain);
    return drainPending(insertPending(root, item, resolved.row), [
      ...rest,
      ...resolved.pending,
    ]);
  }

  type AnchorEntry = { path: number[]; row: ComposedRow };

  function entriesOf(row: ComposedRow, prefix: number[]): AnchorEntry[] {
    return row.children.flatMap((child, index) => {
      const path = [...prefix, index];
      return [{ path, row: child }, ...entriesOf(child, path)];
    });
  }

  function scopePrefix(root: ComposedRow, path: number[]): number[] {
    const found = path.slice(0, -1).reduce<{
      walk: ComposedRow[];
      scope: number[] | undefined;
    }>(
      (acc, index, depth) => {
        if (acc.scope !== undefined) {
          return acc;
        }
        const row = acc.walk[index];
        if (row.reader && row.target !== undefined) {
          return { walk: row.children, scope: path.slice(0, depth + 1) };
        }
        return { walk: row.children, scope: undefined };
      },
      { walk: root.children, scope: undefined }
    );
    return found.scope ?? [];
  }

  function isPathPrefix(prefix: number[], path: number[]): boolean {
    return (
      prefix.length <= path.length &&
      prefix.every((value, index) => path[index] === value)
    );
  }

  function moveOneAnchor(root: ComposedRow): ComposedRow | undefined {
    const entries = entriesOf(root, []);
    return entries.reduce<ComposedRow | undefined>((done, entry) => {
      if (done) {
        return done;
      }
      const { path, row } = entry;
      if (!row.reader) {
        return undefined;
      }
      const anchor = row.node.extraAttrs?.after;
      if (anchor === undefined) {
        return undefined;
      }
      const scope = scopePrefix(root, path);
      const candidates = entries.filter(
        (candidate) =>
          isPathPrefix(scope, candidate.path) &&
          candidate.path.join(",") !== path.join(",") &&
          !isPathPrefix(path, candidate.path) &&
          !candidate.row.flags.some((flag) => DEGRADED_FLAGS.includes(flag)) &&
          (candidate.row.id === anchor || candidate.row.chain.includes(anchor))
      );
      const exact = candidates.filter(
        (candidate) => candidate.row.id === anchor
      );
      const chosen = exact.length > 0 ? exact : candidates;
      if (chosen.length !== 1) {
        return undefined;
      }
      const anchorPath = chosen[0].path;
      const parent = path.slice(0, -1);
      if (
        anchorPath.slice(0, -1).join(",") === parent.join(",") &&
        path[path.length - 1] === anchorPath[anchorPath.length - 1] + 1
      ) {
        return undefined;
      }
      const without = {
        ...root,
        children: replaceAt(root.children, path, []),
      };
      const shifted =
        isPathPrefix(parent, anchorPath) &&
        anchorPath.length > parent.length &&
        anchorPath[parent.length] > path[path.length - 1]
          ? anchorPath.map((value, index) =>
              index === parent.length ? value - 1 : value
            )
          : anchorPath;
      const view = {
        ...row,
        flags: row.flags.filter((flag) => flag !== "lapsed"),
      };
      const insertIndex = shifted[shifted.length - 1] + 1;
      if (shifted.length === 1) {
        return {
          ...without,
          children: [
            ...without.children.slice(0, insertIndex),
            view,
            ...without.children.slice(insertIndex),
          ],
        };
      }
      const anchorParentPath = shifted.slice(0, -1);
      const anchorParent = rowAt(without.children, anchorParentPath);
      const updatedParent = {
        ...anchorParent,
        children: [
          ...anchorParent.children.slice(0, insertIndex),
          view,
          ...anchorParent.children.slice(insertIndex),
        ],
      };
      return {
        ...without,
        children: replaceAt(without.children, anchorParentPath, [
          updatedParent,
        ]),
      };
    }, undefined);
  }

  function followAnchors(root: ComposedRow, rounds: number): ComposedRow {
    if (rounds === 0) {
      return root;
    }
    const moved = moveOneAnchor(root);
    return moved ? followAnchors(moved, rounds - 1) : root;
  }

  function collectRepresented(
    row: ComposedRow,
    chain: ID[],
    acc: globalThis.Map<ID, ID[][]>
  ): globalThis.Map<ID, ID[][]> {
    if (
      row.reader &&
      row.target !== undefined &&
      !row.flags.includes("lapsed")
    ) {
      acc.set(row.target, [...(acc.get(row.target) ?? []), chain]);
    }
    const nextChain = row.reader ? [...chain, row.id] : chain;
    row.children.forEach((child) => collectRepresented(child, nextChain, acc));
    return acc;
  }

  function pruneConsumed(
    row: ComposedRow,
    chain: ID[],
    represented: globalThis.Map<ID, ID[][]>
  ): ComposedRow {
    const nextChain = row.reader ? [...chain, row.id] : chain;
    return {
      ...row,
      children: row.children
        .filter(
          (child) =>
            child.reader ||
            !(represented.get(child.id) ?? []).some((claimChain) =>
              claimChain.every((id, index) => nextChain[index] === id)
            )
        )
        .map((child) => pruneConsumed(child, nextChain, represented)),
    };
  }

  function collectDiagnostics(
    row: ComposedRow,
    seen: globalThis.Set<string>
  ): { code: string; rowId: ID }[] {
    const own = [
      ...row.flags.map((code) => ({ code: code as string, rowId: row.id })),
      ...(row.drift ? [{ code: "drift", rowId: row.id }] : []),
    ].filter(({ code, rowId }) => {
      const key = `${code} ${rowId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return [
      ...own,
      ...row.children.flatMap((child) => collectDiagnostics(child, seen)),
    ];
  }

  const rootRow = find(rootRef.id, rootRef.sourceId);
  if (!rootRow) {
    return { root: danglingStub(rootRef.id), claims: [], diagnostics: [] };
  }

  const rootClaim = claimOf(rootRow);
  const rootTarget = claimTarget(rootClaim);
  const rootScope =
    projects(rootClaim) && rootTarget !== undefined
      ? rootTarget
      : rootRow.node.id;
  const claims = collect(rootRow, rootScope);
  const invalidEmbeds = claims
    .filter((record) => {
      const claimRow = find(record.id, readerSourceId);
      return (
        claimRow !== undefined &&
        claimRow.node.extraAttrs?.embed === "true" &&
        !projects(claimOf(claimRow))
      );
    })
    .map((record) => ({ code: "invalid-embed-shape", rowId: record.id }));

  const resolvedRoot = resolve(rootRow, []);
  const drained = followAnchors(
    drainPending(resolvedRoot.row, resolvedRoot.pending),
    10
  );
  const pruned = pruneConsumed(
    drained,
    [],
    collectRepresented(drained, [], new globalThis.Map<ID, ID[][]>())
  );
  const diagnostics = [
    ...collectDiagnostics(pruned, new globalThis.Set<string>()),
    ...invalidEmbeds,
  ];

  return { root: pruned, claims, diagnostics };
}

function markerBraces(relevance: Relevance, argument: Argument): string {
  const prefix = formatPrefixMarkers(relevance, argument);
  return prefix === "" ? "" : prefix.replace("(", "{").replace(")", "}");
}

export function visibleComposedChildren(row: ComposedRow): ComposedRow[] {
  return row.children.filter((child) => child.relevance !== "not_relevant");
}

export function treeFromComposition(result: CompositionResult): string {
  function render(row: ComposedRow, depth: number): string[] {
    const identity = row.reader ? `id:${row.id}` : `base:${row.id}`;
    const flags = [...row.flags]
      .sort()
      .map((flag) => ` flag:${flag}`)
      .join("");
    const line = `${"  ".repeat(depth)}${markerBraces(
      row.relevance,
      row.argument
    )}${row.text} <!-- ${identity}${flags} -->`;
    return [
      line,
      ...visibleComposedChildren(row).flatMap((child) =>
        render(child, depth + 1)
      ),
    ];
  }
  return `${render(result.root, 0).join("\n")}\n`;
}
