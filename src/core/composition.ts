/* eslint-disable @typescript-eslint/no-use-before-define */
import { List } from "immutable";
import { formatPrefixMarkers } from "../documentFormat";
import { EMPTY_NODE_ID } from "./connections";
import { isCalendarEntryId } from "./ical";
import type { AddToParentTarget } from "./plan";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  lookupNode,
} from "./graphLookup";
import {
  effectiveText,
  embeddedTarget,
  nodeText,
  plainSpans,
  rewordingTargets,
} from "./nodeSpans";

export type Occurrence = {
  key: string;
  id: ID;
  line: ResolvedNode;
  persisted: ResolvedNode | undefined;
  source: ResolvedNode;
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
  children: Occurrence[];
  writeParent: ID;
  parent: NodeRef | undefined;
  physicalParent: NodeRef | undefined;
  sourceParent: NodeRef | undefined;
  positionScope: string;
  sourceShowing: string | undefined;
  consumes: boolean;
};

export type OccurrenceGraph = {
  root: Occurrence;
  claims: {
    id: ID;
    kind: Occurrence["kind"];
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

export type Gesture =
  | {
      kind: "judge";
      row: Occurrence;
      relevance: Relevance;
      argument: Argument;
      spans: InlineSpan[];
    }
  | {
      kind: "move";
      rows: {
        row: Occurrence;
        sourceParent: Occurrence | undefined;
        predecessor: Occurrence | undefined;
        path: readonly [number, ...ID[]];
      }[];
      parent: Occurrence;
      parentPath: readonly [number, ...ID[]];
      after: Occurrence | undefined;
    }
  | {
      kind: "reword";
      row: Occurrence;
      spans: InlineSpan[];
    }
  | {
      kind: "place";
      targets: {
        target: AddToParentTarget;
        relevance: Relevance;
        argument: Argument;
      }[];
      parent: Occurrence;
      at: number | undefined;
      after: Occurrence | undefined;
    }
  | {
      kind: "dismiss";
      row: Occurrence;
      spans: InlineSpan[];
    };

export type PositionName = { kind: "after" | "before" | "parent"; id: ID };

function rowKind(node: GraphNode): Occurrence["kind"] {
  if (rewordingTargets(node).length > 0) {
    return "speaking";
  }
  if (embeddedTarget(node) !== undefined) {
    return "placement";
  }
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  if (
    span?.kind === "link" &&
    span.struck !== true &&
    span.href.startsWith("#")
  ) {
    return "link";
  }
  return "own";
}

function rowTargets(node: GraphNode): ID[] {
  const rewording = rewordingTargets(node);
  if (rewording.length > 0) {
    return rewording;
  }
  if (node.extraAttrs?.rewordedFrom !== undefined) {
    const span = node.spans.find(
      (candidate) =>
        candidate.kind === "link" &&
        candidate.struck !== true &&
        candidate.href.startsWith("#")
    );
    return span?.kind === "link" ? [span.href.slice(1)] : [];
  }
  const embedded = embeddedTarget(node);
  if (embedded !== undefined) {
    return [embedded];
  }
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" &&
    span.struck !== true &&
    span.href.startsWith("#")
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

function overlays(node: GraphNode): boolean {
  return (
    projects(node) ||
    node.extraAttrs?.rewordedFrom !== undefined ||
    (rowKind(node) === "link" &&
      (node.relevance !== undefined || node.argument !== undefined))
  );
}

function isFeedRoot(node: GraphNode): boolean {
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" && span.href === node.id;
}

export function positionNames(node: GraphNode): PositionName[] {
  return Object.entries(node.extraAttrs ?? {}).flatMap(([key, value]) =>
    key === "after" || key === "before" || key === "parent"
      ? [{ kind: key, id: value }]
      : []
  );
}

export function clearPosition(
  attrs: Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs ?? {}).filter(
      ([key]) => key !== "after" && key !== "before" && key !== "parent"
    )
  );
}

export function positionAttrs(names: PositionName[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name.kind, name.id]));
}

export function positionOf(node: GraphNode): string | undefined {
  const names = positionNames(node);
  return names.length === 0
    ? undefined
    : names.map((name) => `${name.kind}:${name.id}`).join(" ");
}

function frozenText(node: GraphNode): string {
  const kind = rowKind(node);
  if (node.extraAttrs?.rewordedFrom !== undefined) {
    return node.extraAttrs.rewordedFrom;
  }
  if (kind === "speaking") {
    return (
      node.spans.find((span) => span.kind === "link" && span.struck === true)
        ?.text ?? nodeText(node)
    );
  }
  if (kind === "placement" || kind === "link") {
    return node.spans[0]?.text ?? nodeText(node);
  }
  return nodeText(node);
}

function hasMarker(node: GraphNode): boolean {
  return node.relevance !== undefined || node.argument !== undefined;
}

function dedupe<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function withFlag(
  row: Occurrence,
  flag: Occurrence["flags"][number]
): Occurrence {
  return row.flags.includes(flag)
    ? row
    : { ...row, flags: [...row.flags, flag] };
}

function withoutFlag(
  row: Occurrence,
  flag: Occurrence["flags"][number]
): Occurrence {
  return row.flags.includes(flag)
    ? { ...row, flags: row.flags.filter((value) => value !== flag) }
    : row;
}

function paths(
  rows: Occurrence[],
  predicate: (row: Occurrence) => boolean,
  prefix: number[] = []
): number[][] {
  return rows.flatMap((row, index) => {
    const path = [...prefix, index];
    return [
      ...(predicate(row) ? [path] : []),
      ...paths(row.children, predicate, path),
    ];
  });
}

function at(rows: Occurrence[], path: number[]): Occurrence | undefined {
  const first = rows[path[0]];
  return path
    .slice(1)
    .reduce<Occurrence | undefined>(
      (row, index) => row?.children[index],
      first
    );
}

function replace(
  rows: Occurrence[],
  path: number[],
  replacements: Occurrence[]
): Occurrence[] {
  const [index, ...rest] = path;
  if (index === undefined) {
    return rows;
  }
  if (rest.length === 0) {
    return [...rows.slice(0, index), ...replacements, ...rows.slice(index + 1)];
  }
  const row = rows[index];
  if (!row) {
    return rows;
  }
  return [
    ...rows.slice(0, index),
    { ...row, children: replace(row.children, rest, replacements) },
    ...rows.slice(index + 1),
  ];
}

function matchPath(
  rows: Occurrence[],
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

function isPathPrefix(prefix: number[], path: number[]): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((value, index) => path[index] === value)
  );
}

function updateByKey(
  row: Occurrence,
  key: string,
  update: (found: Occurrence) => Occurrence
): Occurrence {
  if (row.key === key) {
    return update(row);
  }
  return {
    ...row,
    children: row.children.map((child) => updateByKey(child, key, update)),
  };
}

function removeKeyFromForest(rows: Occurrence[], key: string): Occurrence[] {
  return rows
    .filter((row) => row.key !== key)
    .map((row) => ({
      ...row,
      children: removeKeyFromForest(row.children, key),
    }));
}

function removeByKey(row: Occurrence, key: string): Occurrence {
  return {
    ...row,
    children: removeKeyFromForest(row.children, key),
  };
}

function entriesOf(root: Occurrence): {
  path: number[];
  row: Occurrence;
  hidden: boolean;
  readerAncestors: ID[];
}[] {
  const walk = (
    rows: Occurrence[],
    prefix: number[],
    hidden: boolean,
    readerAncestors: ID[]
  ): ReturnType<typeof entriesOf> =>
    rows.flatMap((row, index) => {
      const path = [...prefix, index];
      const rowHidden = hidden || row.relevance === "not_relevant";
      const nextAncestors = row.persisted
        ? [...readerAncestors, row.id]
        : readerAncestors;
      return [
        { path, row, hidden: rowHidden, readerAncestors },
        ...walk(row.children, path, rowHidden, nextAncestors),
      ];
    });
  return walk(root.children, [], false, root.persisted ? [root.id] : []);
}

function insertRelative(
  root: Occurrence,
  row: Occurrence,
  anchorKey: string,
  kind: PositionName["kind"],
  firstChild: boolean
): Occurrence {
  const insert = (current: Occurrence): [Occurrence, boolean] => {
    if (current.key === anchorKey && kind === "parent") {
      return [
        {
          ...current,
          children: firstChild
            ? [row, ...current.children]
            : [...current.children, row],
        },
        true,
      ];
    }
    const anchorIndex = current.children.findIndex(
      (child) => child.key === anchorKey
    );
    if (anchorIndex >= 0 && kind !== "parent") {
      const index = kind === "after" ? anchorIndex + 1 : anchorIndex;
      return [
        {
          ...current,
          children: [
            ...current.children.slice(0, index),
            row,
            ...current.children.slice(index),
          ],
        },
        true,
      ];
    }
    return current.children.reduce<[Occurrence, boolean]>(
      ([parent, done], child) => {
        if (done) {
          return [parent, true];
        }
        const [updated, found] = insert(child);
        return [
          found
            ? {
                ...parent,
                children: parent.children.map((candidate) =>
                  candidate.key === child.key ? updated : candidate
                ),
              }
            : parent,
          found,
        ];
      },
      [current, false]
    );
  };
  return insert(root)[0];
}

function resolvePositions(root: Occurrence): Occurrence {
  const initial = entriesOf(root);
  const positioned = initial.filter(
    (entry) => positionNames(entry.row.line.node).length > 0
  );
  const decisions = positioned.map((entry) => {
    const names = positionNames(entry.row.line.node);
    const physicalScope = entry.row.physicalParent
      ? initial.find(
          (candidate) =>
            candidate.row.persisted?.node.id === entry.row.physicalParent?.id &&
            projects(candidate.row.line.node)
        )
      : undefined;
    const isPhysicalParent = (
      candidate: ReturnType<typeof entriesOf>[number]
    ): boolean =>
      entry.row.physicalParent?.id === candidate.row.id &&
      candidate.row.key === entry.row.positionScope;

    const resolutions = names.map((name) => {
      const candidates = initial.filter((candidate) => {
        const sameParent =
          candidate.path.slice(0, -1).join(",") ===
          entry.path.slice(0, -1).join(",");
        return (
          (!candidate.hidden || sameParent) &&
          candidate.row.key !== entry.row.key &&
          (candidate.row.positionScope === entry.row.positionScope ||
            (name.kind === "parent" && isPhysicalParent(candidate))) &&
          !isPathPrefix(entry.path, candidate.path) &&
          !candidate.row.flags.some(
            (flag) =>
              (flag === "dangling" &&
                !(
                  name.kind === "parent" &&
                  candidate.row.persisted?.node.id ===
                    entry.row.physicalParent?.id
                )) ||
              flag === "orphan-source" ||
              flag === "cycle"
          ) &&
          (candidate.row.id === name.id ||
            candidate.row.chain.includes(name.id))
        );
      });
      const exact = candidates.filter(
        (candidate) => candidate.row.id === name.id
      );
      const chosen = exact.length > 0 ? exact : candidates;
      const physicallyScoped = physicalScope
        ? chosen.filter(
            (candidate) =>
              candidate.row.persisted?.node.id === physicalScope.row.id ||
              candidate.readerAncestors.includes(physicalScope.row.id)
          )
        : [];
      return {
        name,
        candidates:
          chosen.length > 1 && physicallyScoped.length > 0
            ? physicallyScoped
            : chosen,
      };
    });
    const selected =
      resolutions.find((resolution) => resolution.candidates.length === 1) ??
      resolutions.find((resolution) => resolution.candidates.length > 0);
    return { entry, names, resolutions, selected };
  });
  const valid = decisions.filter((decision) => {
    const { selected } = decision;
    const candidate = selected?.candidates[0];
    if (!selected || selected.candidates.length !== 1 || !candidate) {
      return false;
    }
    if (
      selected.name.kind === "parent" &&
      decision.entry.path.length === candidate.path.length + 1 &&
      isPathPrefix(candidate.path, decision.entry.path)
    ) {
      const sourceParent = decision.entry.row.sourceParent?.id;
      const remainsWithSource =
        sourceParent !== undefined &&
        (candidate.row.id === sourceParent ||
          candidate.row.chain.includes(sourceParent));
      const remainsPhysical =
        decision.entry.row.physicalParent?.id === candidate.row.id &&
        candidate.row.id === selected.name.id;
      const index = decision.entry.path[decision.entry.path.length - 1];
      const bare = decision.names.every((name) => name.kind === "parent");
      const parentPeers = decisions.filter(
        (peer) =>
          peer.entry.path.slice(0, -1).join(",") ===
            decision.entry.path.slice(0, -1).join(",") &&
          peer.selected?.name.kind === "parent" &&
          peer.selected.candidates.length === 1 &&
          peer.selected.candidates[0]?.row.key === candidate.row.key
      );
      if (bare && parentPeers.length > 1) {
        return parentPeers.every(
          (peer) => !hasMarker(peer.entry.row.line.node)
        );
      }
      if (remainsWithSource || remainsPhysical) {
        return false;
      }
      return bare ? index !== 0 : index !== candidate.row.children.length - 1;
    }
    return true;
  });
  const positionedKeys = new globalThis.Set(
    valid.map((decision) => decision.entry.row.key)
  );
  const links = valid.flatMap((decision) =>
    decision.resolutions.flatMap((resolution) => {
      const anchor =
        resolution.candidates.length === 1
          ? resolution.candidates[0]?.row.key
          : undefined;
      return anchor && positionedKeys.has(anchor)
        ? [{ row: decision.entry.row.key, anchor }]
        : [];
    })
  );
  const edges = valid.flatMap((decision) => {
    const { selected } = decision;
    const anchor = selected?.candidates[0]?.row.key;
    if (!selected || !anchor || !positionedKeys.has(anchor)) {
      return [];
    }
    return selected.name.kind === "before"
      ? [{ from: decision.entry.row.key, to: anchor }]
      : [{ from: anchor, to: decision.entry.row.key }];
  });
  const cyclic = new globalThis.Set(
    edges.flatMap((edge) => {
      const visit = (key: string, seen: string[]): string[] => {
        const next = edges.filter((candidate) => candidate.from === key);
        return next.flatMap((candidate) => {
          const index = seen.indexOf(candidate.to);
          return index >= 0
            ? seen.slice(index)
            : visit(candidate.to, [...seen, candidate.to]);
        });
      };
      return visit(edge.from, [edge.from]);
    })
  );
  const stationary = decisions.reduce((tree, decision) => {
    if (decision.selected === undefined) {
      return updateByKey(tree, decision.entry.row.key, (row) =>
        withFlag(row, "lapsed")
      );
    }
    if (decision.selected.candidates.length !== 1) {
      return updateByKey(tree, decision.entry.row.key, (row) =>
        withFlag(row, "ambiguous-anchor")
      );
    }
    return tree;
  }, root);
  const components = valid.reduce<string[][]>((result, decision) => {
    const { key } = decision.entry.row;
    if (result.some((component) => component.includes(key))) {
      return result;
    }
    const collect = (queue: string[], found: string[]): string[] => {
      const [current, ...remaining] = queue;
      if (current === undefined) {
        return found;
      }
      if (found.includes(current)) {
        return collect(remaining, found);
      }
      const adjacent = links.flatMap((link) => {
        if (link.row === current) {
          return [link.anchor];
        }
        return link.anchor === current ? [link.row] : [];
      });
      return collect([...remaining, ...adjacent], [...found, current]);
    };
    return [...result, collect([key], [])];
  }, []);
  const positionedTree = components.reduce((tree, component) => {
    if (component.some((key) => cyclic.has(key))) {
      return tree;
    }
    const members = valid.filter((decision) =>
      component.includes(decision.entry.row.key)
    );
    const external = members.some((decision) =>
      decision.resolutions.some((resolution) => {
        const anchor =
          resolution.candidates.length === 1
            ? resolution.candidates[0]?.row.key
            : undefined;
        return anchor !== undefined && !component.includes(anchor);
      })
    );
    const pivot = external
      ? undefined
      : members.find(
          (decision) =>
            decision.selected?.name.kind === "before" &&
            decision.selected.candidates[0] !== undefined
        )?.selected?.candidates[0]?.row.key;
    if (!external && pivot === undefined) {
      return tree;
    }
    const movable = members.filter(
      (decision) => decision.entry.row.key !== pivot
    );
    const movableKeys = movable.map((decision) => decision.entry.row.key);
    const detachedRow = (row: Occurrence): Occurrence => ({
      ...row,
      children: movableKeys.reduce(
        (children, key) => removeKeyFromForest(children, key),
        row.children
      ),
    });
    const removed = movable.reduce(
      (current, decision) => removeByKey(current, decision.entry.row.key),
      tree
    );
    const placeReady = (
      current: Occurrence,
      remaining: typeof movable
    ): Occurrence => {
      if (remaining.length === 0) {
        return current;
      }
      const living = new globalThis.Set(
        entriesOf(current).map((entry) => entry.row.key)
      );
      const selectedReady = remaining.filter((decision) => {
        const anchor = decision.selected?.candidates[0]?.row.key;
        return anchor !== undefined && living.has(anchor);
      });
      const ready = [
        ...(selectedReady.length > 0
          ? selectedReady
          : remaining.filter((decision) =>
              decision.resolutions.some(
                (resolution) =>
                  resolution.candidates.length === 1 &&
                  living.has(resolution.candidates[0]?.row.key ?? "")
              )
            )),
      ].sort((left, right) =>
        left.entry.path.join(",").localeCompare(right.entry.path.join(","))
      );
      if (ready.length === 0) {
        return current;
      }
      const placed = ready.reduce((next, decision) => {
        const nextLiving = new globalThis.Set(
          entriesOf(next).map((entry) => entry.row.key)
        );
        const { selected } = decision;
        const preferred =
          selected?.candidates.length === 1 &&
          nextLiving.has(selected.candidates[0]?.row.key ?? "")
            ? selected
            : decision.resolutions.find(
                (resolution) =>
                  resolution.candidates.length === 1 &&
                  nextLiving.has(resolution.candidates[0]?.row.key ?? "")
              );
        const [anchor] = preferred?.candidates ?? [];
        if (!preferred || !anchor) {
          return next;
        }
        return insertRelative(
          next,
          withoutFlag(detachedRow(decision.entry.row), "lapsed"),
          anchor.row.key,
          preferred.name.kind,
          preferred.name.kind === "parent" &&
            decision.names.every((name) => name.kind === "parent")
        );
      }, current);
      return placeReady(
        placed,
        remaining.filter(
          (decision) =>
            !ready.some(
              (placedDecision) =>
                placedDecision.entry.row.key === decision.entry.row.key
            )
        )
      );
    };
    return placeReady(removed, movable);
  }, stationary);
  return positionedTree;
}

function assignRelationships(
  row: Occurrence,
  writeParent: ID,
  parent: NodeRef | undefined
): Occurrence {
  const childParent = row.persisted ? row.id : writeParent;
  return {
    ...row,
    writeParent,
    parent,
    children: row.children.map((child) =>
      assignRelationships(child, childParent, row.line.ref)
    ),
  };
}

function collectDiagnostics(root: Occurrence): OccurrenceGraph["diagnostics"] {
  return [
    ...root.flags.map((code) => ({
      code,
      rowId: root.id,
      details: undefined,
    })),
    ...(root.drift
      ? [{ code: "drift", rowId: root.id, details: root.drift }]
      : []),
    ...root.children.flatMap(collectDiagnostics),
  ];
}

function dedupeDiagnostics(
  entries: OccurrenceGraph["diagnostics"]
): OccurrenceGraph["diagnostics"] {
  return entries.filter((entry, index) => {
    const key = `${entry.code}:${entry.rowId}:${entry.details?.frozen ?? ""}:${
      entry.details?.current ?? ""
    }`;
    return (
      entries.findIndex(
        (candidate) =>
          `${candidate.code}:${candidate.rowId}:${
            candidate.details?.frozen ?? ""
          }:${candidate.details?.current ?? ""}` === key
      ) === index
    );
  });
}

function markerText(relevance: Relevance, argument: Argument): string {
  const prefix = formatPrefixMarkers(relevance, argument);
  return prefix === "" ? "" : prefix.replace("(", "{").replace(")", "}");
}

export function buildOccurrences(
  graph: GraphLookup,
  rootRef: NodeRef
): OccurrenceGraph {
  const absorbed = new globalThis.Set<ID>();
  const fileOrder = new globalThis.Map<string, number>();

  const readerNode = (id: ID): ResolvedNode | undefined => {
    const resolved = getNodeInSource(graph, {
      sourceId: rootRef.sourceId,
      id,
    });
    return resolved?.node.root === rootRef.id ? resolved : undefined;
  };

  const isReaderLine = (line: ResolvedNode): boolean =>
    line.ref.sourceId === rootRef.sourceId && line.node.root === rootRef.id;

  const childRows = (owner: ResolvedNode): ResolvedNode[] =>
    owner.node.children
      .toArray()
      .filter((id) => id !== EMPTY_NODE_ID)
      .flatMap((id) => {
        const child = getNodeInSource(graph, {
          sourceId: owner.ref.sourceId,
          id,
        });
        return child ? [child] : [];
      });

  const rootResolved = getNodeInSource(graph, rootRef);
  const fallbackNode: GraphNode = {
    children: List<ID>(),
    id: rootRef.id,
    spans: plainSpans(rootRef.id),
    updated: 0,
    root: rootRef.id,
    relevance: undefined,
  };
  const fallbackLine: ResolvedNode = {
    ref: rootRef,
    node: fallbackNode,
  };

  const danglingOccurrence = (
    line: ResolvedNode,
    key: string,
    positionScope: string,
    physicalParent: NodeRef | undefined
  ): Occurrence => ({
    key,
    id: line.node.id,
    line,
    persisted: isReaderLine(line) ? line : undefined,
    source: line,
    kind: "placement",
    target: line.node.id,
    chain: [line.node.id],
    text: nodeText(line.node),
    relevance: line.node.relevance,
    argument: line.node.argument,
    judgments: [],
    flags: ["dangling"],
    drift: undefined,
    children: [],
    writeParent: rootRef.id,
    parent: undefined,
    physicalParent,
    sourceParent: undefined,
    positionScope,
    sourceShowing: undefined,
    consumes: false,
  });

  if (!rootResolved) {
    const root = danglingOccurrence(
      fallbackLine,
      `${rootRef.sourceId}:${rootRef.id}`,
      `${rootRef.sourceId}:${rootRef.id}`,
      undefined
    );
    return { root, claims: [], diagnostics: [] };
  }

  const rootTarget = targetOf(rootResolved.node);
  const baseEntry =
    projects(rootResolved.node) && rootTarget !== undefined
      ? lookupNode(graph, rootTarget, rootRef.sourceId)
      : undefined;
  const baseRoot = baseEntry
    ? getNodeInSource(graph, {
        sourceId: baseEntry.ref.sourceId,
        id: baseEntry.node.root,
      }) ?? baseEntry
    : undefined;

  const scanAbsorbed = (line: ResolvedNode): void => {
    if (projects(line.node)) {
      rowTargets(line.node).forEach((target) => {
        if (readerNode(target)) {
          absorbed.add(target);
        }
      });
    }
    childRows(line).forEach(scanAbsorbed);
  };
  if (baseRoot) {
    scanAbsorbed(baseRoot);
  }

  const rootScope =
    projects(rootResolved.node) && rootTarget !== undefined
      ? rootTarget
      : rootResolved.node.id;

  const collectClaims = (
    owner: ResolvedNode,
    context: ID
  ): OccurrenceGraph["claims"] =>
    childRows(owner).flatMap((child, index) => {
      fileOrder.set(`${owner.node.id}\0${child.node.id}`, index);
      const target = targetOf(child.node);
      const childContext =
        projects(child.node) && target !== undefined ? target : child.node.id;
      return [
        {
          id: child.node.id,
          kind: rowKind(child.node),
          target,
          relevance: child.node.relevance,
          argument: child.node.argument,
          text: nodeText(child.node),
          context,
          parent: owner.node.id,
        },
        ...collectClaims(child, childContext),
      ];
    });
  const claims = collectClaims(rootResolved, rootScope);

  const makeOccurrence = (
    line: ResolvedNode,
    source: ResolvedNode,
    key: string,
    positionScope: string,
    physicalParent: NodeRef | undefined,
    fields: Pick<
      Occurrence,
      | "chain"
      | "text"
      | "relevance"
      | "argument"
      | "judgments"
      | "flags"
      | "drift"
      | "children"
      | "sourceParent"
      | "sourceShowing"
      | "consumes"
    >
  ): Occurrence => ({
    key,
    id: line.node.id,
    line,
    persisted: isReaderLine(line) ? line : undefined,
    source,
    kind: rowKind(line.node),
    target: targetOf(line.node),
    writeParent: rootRef.id,
    parent: undefined,
    physicalParent,
    positionScope,
    ...fields,
  });

  function resolveLine(
    start: ResolvedNode,
    active: ID[],
    key: string,
    positionScope: string,
    withinProjection: boolean,
    physicalParent: NodeRef | undefined
  ): [Occurrence, ResolvedNode[]] {
    const walk = (
      current: ResolvedNode,
      visited: ID[]
    ): {
      layers: ResolvedNode[];
      chain: ID[];
      flags: Occurrence["flags"];
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
        const target = targetOf(current.node);
        const dangling =
          kind === "link" &&
          target !== undefined &&
          lookupNode(graph, target, current.ref.sourceId) === undefined;
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
      if (target === undefined || nextVisited.includes(target)) {
        return {
          layers: [current],
          chain: [current.node.id, ...(target ? [target] : [])],
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
      const rest = walk(next, nextVisited);
      return {
        layers: [current, ...rest.layers],
        chain: [current.node.id, ...rest.chain],
        flags: rest.flags,
        terminal: rest.terminal,
        merged: rest.merged,
      };
    };

    const walked = walk(start, active);
    const activeChain = dedupe([...active, ...walked.chain]);
    const childScope =
      projects(start.node) && !withinProjection ? key : positionScope;
    const childWithinProjection = withinProjection || projects(start.node);
    const { merged } = walked;
    const bonds: {
      chain: ID[];
      flags: Occurrence["flags"];
      children: Occurrence[];
      judgments: Occurrence["judgments"];
      pending: ResolvedNode[];
      source: ResolvedNode;
    }[] = merged
      ? rowTargets(merged.node).map((target, index) => {
          if (activeChain.includes(target)) {
            return {
              chain: [target],
              flags: ["cycle"],
              children: [],
              judgments: [],
              pending: [],
              source: merged,
            };
          }
          const source = lookupNode(graph, target, merged.ref.sourceId);
          if (!source) {
            return {
              chain: [target],
              flags: ["orphan-source"],
              children: [],
              judgments: [],
              pending: [],
              source: merged,
            };
          }
          const [bond, pending] = resolveLine(
            source,
            activeChain,
            `${key}/bond:${index}:${source.ref.sourceId}:${source.node.id}`,
            childScope,
            childWithinProjection,
            source.node.parent
              ? { sourceId: source.ref.sourceId, id: source.node.parent }
              : undefined
          );
          return {
            chain: bond.chain,
            flags: bond.flags,
            children: bond.children,
            judgments: bond.judgments,
            pending,
            source: bond.source,
          };
        })
      : [];

    const terminalChildren = walked.terminal
      ? childRows(walked.terminal)
          .filter((child) => !absorbed.has(child.node.id))
          .map((child, index) =>
            resolveLine(
              child,
              activeChain,
              `${key}/${index}:${child.ref.sourceId}:${child.node.id}`,
              childScope,
              childWithinProjection,
              {
                sourceId: walked.terminal?.ref.sourceId ?? child.ref.sourceId,
                id: walked.terminal?.node.id ?? start.node.id,
              }
            )
          )
      : [];

    const initialChildren = walked.merged
      ? bonds.flatMap((bond) => bond.children)
      : terminalChildren.map(([child]) => child);
    const initialPending = walked.merged
      ? bonds.flatMap((bond) => bond.pending)
      : terminalChildren.flatMap(([, pending]) => pending);
    const delegated =
      !walked.merged && walked.terminal
        ? walked.layers.slice(0, -1)
        : walked.layers;
    const layered = [...delegated].reverse().reduce<{
      children: Occurrence[];
      pending: ResolvedNode[];
    }>(
      (state, layer) => {
        const result = applyLayer(
          state.children,
          layer,
          activeChain,
          key,
          childScope,
          childWithinProjection
        );
        return {
          children: result[0],
          pending: [...state.pending, ...result[1]],
        };
      },
      { children: initialChildren, pending: initialPending }
    );

    const speaking = walked.layers.find(
      (layer) => rowKind(layer.node) === "speaking"
    );
    const source =
      walked.terminal ?? bonds[0]?.source ?? walked.layers[0] ?? start;
    const layerText = walked.layers[0]
      ? frozenText(walked.layers[0].node)
      : start.node.id;
    const terminalText = walked.terminal
      ? nodeText(walked.terminal.node)
      : layerText;
    const projectedText =
      walked.terminal &&
      isFeedRoot(walked.terminal.node) &&
      walked.layers.length > 1
        ? layerText
        : terminalText;
    const speakingText = speaking
      ? effectiveText(speaking.node)
      : projectedText;
    const text = start.node.extraAttrs?.rewordedFrom
      ? effectiveText(start.node)
      : speakingText;
    const judgments = [
      ...walked.layers
        .filter((layer) => hasMarker(layer.node))
        .map((layer) => ({
          id: layer.node.id,
          relevance: layer.node.relevance,
          argument: layer.node.argument,
        })),
      ...bonds.flatMap((bond) => bond.judgments),
    ];
    const effective = judgments[0];
    const sourceParent =
      (!isReaderLine(start) || projects(start.node)) &&
      source.node.parent !== undefined
        ? { sourceId: source.ref.sourceId, id: source.node.parent }
        : undefined;
    return [
      makeOccurrence(start, source, key, positionScope, physicalParent, {
        chain: dedupe([
          ...walked.chain,
          ...bonds.flatMap((bond) => bond.chain),
        ]),
        text,
        relevance: effective?.relevance,
        argument: effective?.argument,
        judgments,
        flags: dedupe([
          ...walked.flags,
          ...bonds.flatMap((bond) => bond.flags),
        ]),
        drift: undefined,
        children: layered.children,
        sourceParent,
        sourceShowing: undefined,
        consumes: projects(start.node),
      }),
      layered.pending,
    ];
  }

  function place(
    claim: ResolvedNode,
    source: Occurrence,
    active: ID[],
    key: string,
    positionScope: string,
    withinProjection: boolean,
    physicalParent: NodeRef
  ): [Occurrence, ResolvedNode[]] {
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
    const claimChildren = source.children;
    const layered = applyLayer(
      claimChildren,
      claim,
      [...active, claim.node.id],
      key,
      positionScope,
      withinProjection || projects(claim.node)
    );
    const target = targetOf(claim.node);
    const drift =
      rowKind(claim.node) === "placement" &&
      target !== source.id &&
      frozenText(claim.node) !== source.text
        ? { frozen: frozenText(claim.node), current: source.text }
        : undefined;
    return [
      makeOccurrence(claim, source.source, key, positionScope, physicalParent, {
        chain: [claim.node.id, ...source.chain],
        text:
          rowKind(claim.node) === "speaking" ||
          claim.node.extraAttrs?.rewordedFrom !== undefined
            ? effectiveText(claim.node)
            : source.text,
        relevance: effective?.relevance,
        argument: effective?.argument,
        judgments,
        flags: [...source.flags],
        drift,
        children: layered[0],
        sourceParent: source.sourceParent,
        sourceShowing: source.key,
        consumes: positionNames(claim.node).length === 0,
      }),
      layered[1],
    ];
  }

  function applyLayer(
    inner: Occurrence[],
    owner: ResolvedNode,
    active: ID[],
    ownerKey: string,
    positionScope: string,
    withinProjection: boolean
  ): [Occurrence[], ResolvedNode[]] {
    const layerClaims = childRows(owner).filter(
      (claim) => !absorbed.has(claim.node.id)
    );
    const matches = layerClaims.map((claim) => {
      const target = targetOf(claim.node);
      const match =
        target !== undefined &&
        (overlays(claim.node) || positionNames(claim.node).length > 0)
          ? matchPath(inner, target)
          : "none";
      const edgeLapsed =
        claim.node.argument !== undefined &&
        overlays(claim.node) &&
        target !== undefined &&
        lookupNode(graph, target, claim.ref.sourceId) !== undefined &&
        !(globalThis.Array.isArray(match) && match.length === 1);
      return { claim, match: edgeLapsed ? "edge-lapsed" : match };
    });
    const grouped = matches.reduce<globalThis.Map<string, ResolvedNode[]>>(
      (groups, entry) => {
        if (!globalThis.Array.isArray(entry.match)) {
          return groups;
        }
        const group = groups.get(entry.match.join(",")) ?? [];
        return new globalThis.Map(groups).set(entry.match.join(","), [
          ...group,
          entry.claim,
        ]);
      },
      new globalThis.Map<string, ResolvedNode[]>()
    );
    const groupedPaths = [...grouped.keys()]
      .map((value) => value.split(",").map((index) => Number(index)))
      .sort((left, right) =>
        left.length === right.length
          ? right.join(",").localeCompare(left.join(","))
          : right.length - left.length
      );
    const groupedResult = groupedPaths.reduce<{
      sequence: Occurrence[];
      detached: Occurrence[];
      pending: ResolvedNode[];
      consumed: string[];
    }>(
      (state, path) => {
        const source = at(state.sequence, path);
        if (!source) {
          return state;
        }
        const group = grouped.get(path.join(",")) ?? [];
        const prepared = group.map((claim) => {
          const secondaries = rowTargets(claim.node)
            .slice(1)
            .flatMap((target) => {
              const secondaryPath = matchPath(inner, target);
              if (!globalThis.Array.isArray(secondaryPath)) {
                return [];
              }
              const secondary = at(inner, secondaryPath);
              return secondary && secondary.key !== source.key
                ? [secondary]
                : [];
            });
          return {
            claim,
            source: secondaries.reduce<Occurrence>(
              (combined, secondary) => ({
                ...combined,
                children: [...combined.children, ...secondary.children],
                judgments: [...combined.judgments, ...secondary.judgments],
                chain: dedupe([...combined.chain, ...secondary.chain]),
              }),
              source
            ),
            consumed: secondaries.map((secondary) => secondary.key),
          };
        });
        const views = prepared.map((entry, index) =>
          place(
            entry.claim,
            entry.source,
            active,
            `${ownerKey}/line:${entry.claim.node.id}:${index}`,
            positionScope,
            withinProjection,
            { sourceId: owner.ref.sourceId, id: owner.node.id }
          )
        );
        const inline = views
          .map(([view]) => view)
          .filter(
            (view) =>
              positionNames(view.line.node).length === 0 || path.length === 1
          );
        const detached = views
          .map(([view]) => view)
          .filter(
            (view) =>
              positionNames(view.line.node).length > 0 && path.length > 1
          );
        return {
          sequence: replace(state.sequence, path, inline),
          detached: [...state.detached, ...detached],
          pending: [
            ...state.pending,
            ...views.flatMap(([, pending]) => pending),
          ],
          consumed: [
            ...state.consumed,
            ...prepared.flatMap((entry) => entry.consumed),
          ],
        };
      },
      { sequence: inner, detached: [], pending: [], consumed: [] }
    );
    const sequence = groupedResult.consumed.reduce(
      (rows, key) => removeKeyFromForest(rows, key),
      groupedResult.sequence
    );
    const handled = new globalThis.Set(
      [...grouped.values()].flatMap((group) =>
        group.map((claim) => claim.node.id)
      )
    );
    const rest = matches.reduce<{
      positioned: Occurrence[];
      tail: Occurrence[];
      pending: ResolvedNode[];
    }>(
      (state, entry, index) => {
        if (handled.has(entry.claim.node.id)) {
          return state;
        }
        const target = targetOf(entry.claim.node);
        if (
          entry.match === "none" &&
          overlays(entry.claim.node) &&
          target !== undefined &&
          lookupNode(graph, target, entry.claim.ref.sourceId) !== undefined
        ) {
          return {
            ...state,
            pending: [...state.pending, entry.claim],
          };
        }
        const resolved = resolveLine(
          entry.claim,
          active,
          `${ownerKey}/fallback:${index}:${entry.claim.node.id}`,
          positionScope,
          withinProjection,
          { sourceId: owner.ref.sourceId, id: owner.node.id }
        );
        const row =
          entry.match === "edge-lapsed"
            ? { ...withFlag(resolved[0], "lapsed"), consumes: false }
            : resolved[0];
        return positionNames(entry.claim.node).length > 0
          ? {
              ...state,
              positioned: [...state.positioned, row],
              pending: [...state.pending, ...resolved[1]],
            }
          : {
              ...state,
              tail: [...state.tail, row],
              pending: [...state.pending, ...resolved[1]],
            };
      },
      { positioned: [], tail: [], pending: groupedResult.pending }
    );
    return [
      [
        ...sequence,
        ...groupedResult.detached,
        ...rest.positioned,
        ...rest.tail,
      ],
      rest.pending,
    ];
  }

  const rootKey = `${rootResolved.ref.sourceId}:${rootResolved.node.id}`;
  const resolved = resolveLine(
    rootResolved,
    [],
    rootKey,
    rootKey,
    projects(rootResolved.node),
    undefined
  );

  const insertPending = (
    root: Occurrence,
    line: ResolvedNode,
    row: Occurrence
  ): Occurrence => {
    const parentId = line.node.parent;
    if (parentId === undefined) {
      return { ...root, children: [...root.children, row] };
    }
    const insert = (parent: Occurrence): [Occurrence, boolean] => {
      if (parent.id === parentId && parent.persisted !== undefined) {
        const order =
          fileOrder.get(`${parentId}\0${line.node.id}`) ??
          Number.MAX_SAFE_INTEGER;
        const index = parent.children.findIndex((sibling) => {
          const siblingOrder = fileOrder.get(`${parentId}\0${sibling.id}`);
          return siblingOrder !== undefined && siblingOrder > order;
        });
        const insertionIndex = index < 0 ? parent.children.length : index;
        return [
          {
            ...parent,
            children: [
              ...parent.children.slice(0, insertionIndex),
              row,
              ...parent.children.slice(insertionIndex),
            ],
          },
          true,
        ];
      }
      return parent.children.reduce<[Occurrence, boolean]>(
        ([current, done], child) => {
          if (done) {
            return [current, true];
          }
          const [updated, found] = insert(child);
          return [
            found
              ? {
                  ...current,
                  children: current.children.map((candidate) =>
                    candidate.key === child.key ? updated : candidate
                  ),
                }
              : current,
            found,
          ];
        },
        [parent, false]
      );
    };
    const [updated, inserted] = insert(root);
    return inserted
      ? updated
      : { ...updated, children: [...updated.children, row] };
  };

  const drain = (
    tree: Occurrence,
    queue: ResolvedNode[],
    index: number
  ): Occurrence => {
    const [line, ...remaining] = queue;
    if (!line) {
      return tree;
    }
    const target = targetOf(line.node);
    const match =
      target === undefined ? "none" : matchPath(tree.children, target);
    const from = line.node.extraAttrs?.from;
    const fromEntry =
      from === undefined
        ? undefined
        : entriesOf(tree).find(
            (entry) =>
              entry.row.persisted !== undefined &&
              (entry.row.id === from || entry.row.line.node.parent === from)
          );
    const fromTarget = fromEntry?.row.target;
    const fromSource =
      fromTarget === undefined
        ? undefined
        : entriesOf(tree).find(
            (entry) =>
              fromEntry !== undefined &&
              isPathPrefix(fromEntry.path, entry.path) &&
              entry.row.persisted === undefined &&
              (entry.row.id === fromTarget ||
                entry.row.chain.includes(fromTarget))
          )?.row;
    const matchedSource = globalThis.Array.isArray(match)
      ? at(tree.children, match)
      : undefined;
    const source = matchedSource ?? fromSource;
    if (source) {
      const sourcePath = entriesOf(tree).find(
        (entry) => entry.row.key === source.key
      )?.path;
      if (sourcePath) {
        const physicalParent =
          line.node.parent === undefined
            ? undefined
            : entriesOf(tree).find(
                (entry) => entry.row.persisted?.node.id === line.node.parent
              );
        const nestedProjection = physicalParent
          ? projects(tree.line.node) ||
            entriesOf(tree).some(
              (entry) =>
                entry.path.length < physicalParent.path.length &&
                isPathPrefix(entry.path, physicalParent.path) &&
                projects(entry.row.line.node)
            )
          : false;
        const destinationScope =
          physicalParent && !nestedProjection
            ? physicalParent.row.key
            : physicalParent?.row.positionScope ?? source.positionScope;
        const placed = place(
          line,
          source,
          source.chain,
          `${rootKey}/pending:${index}:${line.node.id}`,
          destinationScope,
          true,
          line.node.parent
            ? { sourceId: line.ref.sourceId, id: line.node.parent }
            : rootRef
        );
        const restoredKey =
          source.persisted?.node.id === line.node.id
            ? source.sourceShowing
            : undefined;
        if (restoredKey !== undefined) {
          const restored = resolveLine(
            source.source,
            source.chain,
            restoredKey,
            source.positionScope,
            true,
            source.sourceParent
          );
          const restoredTree = {
            ...tree,
            children: replace(tree.children, sourcePath, [restored[0]]),
          };
          return drain(
            insertPending(restoredTree, line, placed[0]),
            [...remaining, ...restored[1], ...placed[1]],
            index + 1
          );
        }
        const movedOverlay =
          rowKind(line.node) !== "placement" &&
          source.persisted === undefined &&
          line.node.parent !== undefined &&
          entriesOf(tree).some(
            (entry) =>
              entry.row.persisted?.node.id === line.node.parent &&
              !isPathPrefix(entry.path, sourcePath)
          );
        if (movedOverlay) {
          const restoredTree = {
            ...tree,
            children: replace(tree.children, sourcePath, [source]),
          };
          return drain(
            insertPending(restoredTree, line, placed[0]),
            [...remaining, ...placed[1]],
            index + 1
          );
        }
        return drain(
          {
            ...tree,
            children: replace(tree.children, sourcePath, [placed[0]]),
          },
          [...remaining, ...placed[1]],
          index + 1
        );
      }
    }
    const fallback = resolveLine(
      line,
      tree.chain,
      `${rootKey}/pending-fallback:${index}:${line.node.id}`,
      rootKey,
      projects(rootResolved.node),
      line.node.parent
        ? { sourceId: line.ref.sourceId, id: line.node.parent }
        : undefined
    );
    return drain(
      insertPending(tree, line, fallback[0]),
      [...remaining, ...fallback[1]],
      index + 1
    );
  };

  const consumeFallbacks = (tree: Occurrence): Occurrence => {
    const initial = entriesOf(tree);
    const placements = initial.filter(
      (entry) =>
        entry.row.persisted !== undefined &&
        entry.row.target !== undefined &&
        (entry.row.consumes ||
          (entry.row.sourceShowing !== undefined &&
            entry.row.line.node.extraAttrs?.from === undefined &&
            positionNames(entry.row.line.node).length === 0) ||
          (entry.row.kind === "speaking" &&
            entry.row.sourceShowing !== undefined)) &&
        !(entry.row.kind === "link" && isCalendarEntryId(entry.row.target))
    );
    return placements.reduce((current, placement) => {
      const fresh = entriesOf(current);
      const own = fresh.find((entry) => entry.row.key === placement.row.key);
      if (!own || own.row.target === undefined) {
        return current;
      }
      const from = own.row.line.node.extraAttrs?.from;
      const sourceTarget = targetOf(own.row.line.node);
      const shownSource =
        own.row.sourceShowing === undefined
          ? undefined
          : fresh.find(
              (candidate) => candidate.row.key === own.row.sourceShowing
            );
      const sourceMoved =
        positionNames(own.row.line.node).length > 0 &&
        own.row.physicalParent?.id !== own.row.sourceParent?.id;
      const inFromScope = (
        candidate: ReturnType<typeof entriesOf>[number]
      ): boolean =>
        from !== undefined &&
        (candidate.readerAncestors.includes(from) ||
          candidate.readerAncestors.some((id) => {
            const ancestor = readerNode(id);
            return (
              ancestor?.node.extraAttrs?.from === from ||
              ancestor?.node.parent === from
            );
          }));
      const sameShowing =
        !sourceMoved &&
        shownSource !== undefined &&
        (from === undefined || inFromScope(shownSource))
          ? shownSource
          : undefined;
      const inOccurrenceScope = (
        candidate: ReturnType<typeof entriesOf>[number]
      ): boolean => {
        if (from !== undefined) {
          return inFromScope(candidate);
        }
        const readerAncestors =
          positionNames(own.row.line.node).length > 0
            ? own.readerAncestors.filter(
                (id) => id !== own.row.physicalParent?.id
              )
            : own.readerAncestors;
        return readerAncestors.every(
          (id, index) => candidate.readerAncestors[index] === id
        );
      };
      const candidates = sameShowing
        ? [sameShowing]
        : fresh.filter(
            (candidate) =>
              candidate.row.persisted === undefined &&
              candidate.row.id === sourceTarget &&
              candidate.row.key !== own.row.key &&
              inOccurrenceScope(candidate)
          );
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (!candidate) {
        return current;
      }
      const removed = removeByKey(current, candidate.row.key);
      return updateByKey(removed, own.row.key, (row) => ({
        ...row,
        sourceShowing: candidate.row.key,
      }));
    }, tree);
  };

  const drained = drain(resolved[0], resolved[1], 0);
  const consumed = consumeFallbacks(drained);
  const positioned = resolvePositions(consumed);
  const root = assignRelationships(positioned, rootRef.id, undefined);

  const scanShapes = (line: ResolvedNode): OccurrenceGraph["diagnostics"] => [
    ...(line.node.extraAttrs?.embed === "true" && !projects(line.node)
      ? [
          {
            code: "invalid-embed-shape",
            rowId: line.node.id,
            details: undefined,
          },
        ]
      : []),
    ...childRows(line).flatMap(scanShapes),
  ];
  const diagnostics = dedupeDiagnostics([
    ...collectDiagnostics(root),
    ...scanShapes(rootResolved),
    ...(baseRoot ? scanShapes(baseRoot) : []),
  ]);
  return { root, claims, diagnostics };
}

export function treeFromOccurrences(result: OccurrenceGraph): string {
  const render = (row: Occurrence, depth: number): string[] => {
    const identity = row.persisted ? `id:${row.id}` : `base:${row.id}`;
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
