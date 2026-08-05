import { List } from "immutable";
import { formatPrefixMarkers } from "../documentFormat";
import { EMPTY_NODE_ID } from "./connections";
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
  claimOrder: string;
};

export type CompositionResult = {
  root: ComposedRow;
  claims: {
    id: ID;
    target: ID | undefined;
    relevance: Relevance;
    argument: Argument;
    context: ID;
    parent: ID | undefined;
  }[];
  diagnostics: { code: string; rowId: ID }[];
};

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
      rows: { row: ComposedRow; path: readonly [number, ...ID[]] }[];
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
  | { kind: "place"; row: ComposedRow; parent: ComposedRow }
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

function marker(
  node: GraphNode,
  source: ComposedRow | undefined
): { relevance: Relevance; argument: Argument } {
  return {
    relevance:
      node.relevance !== undefined ? node.relevance : source?.relevance,
    argument: node.argument !== undefined ? node.argument : source?.argument,
  };
}

function withFlag(
  row: ComposedRow,
  flag: ComposedRow["flags"][number]
): ComposedRow {
  return row.flags.includes(flag)
    ? row
    : { ...row, flags: [...row.flags, flag] };
}

function withoutFlag(
  row: ComposedRow,
  flag: ComposedRow["flags"][number]
): ComposedRow {
  return row.flags.includes(flag)
    ? { ...row, flags: row.flags.filter((current) => current !== flag) }
    : row;
}

function degradationFlags(
  kind: ComposedRow["kind"],
  cycle: boolean,
  missing: boolean,
  source: ComposedRow | undefined
): ComposedRow["flags"] {
  if (cycle) {
    return ["cycle"];
  }
  if (missing) {
    return [kind === "speaking" ? "orphan-source" : "dangling"];
  }
  return source?.flags ?? [];
}

function paths(
  rows: ComposedRow[],
  predicate: (row: ComposedRow) => boolean,
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

function insertAfter(
  rows: ComposedRow[],
  path: number[],
  row: ComposedRow
): ComposedRow[] {
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] + 1;
  if (parentPath.length === 0) {
    return [...rows.slice(0, index), row, ...rows.slice(index)];
  }
  const parent = at(rows, parentPath);
  return replace(rows, parentPath, [
    {
      ...parent,
      children: [
        ...parent.children.slice(0, index),
        row,
        ...parent.children.slice(index),
      ],
    },
  ]);
}

function insertAtWrittenParent(
  rows: ComposedRow[],
  row: ComposedRow,
  front: boolean
): ComposedRow[] {
  const parentPaths = paths(
    rows,
    (candidate) => candidate.id === row.writtenParent
  );
  if (parentPaths.length !== 1) {
    return front ? [row, ...rows] : [...rows, row];
  }
  const parentPath = parentPaths[0];
  const parent = at(rows, parentPath);
  const children = front
    ? [row, ...parent.children]
    : [...parent.children, row];
  return replace(rows, parentPath, [{ ...parent, children }]);
}

function targetPaths(rows: ComposedRow[], target: ID): number[][] {
  return paths(
    rows,
    (row) =>
      row.id === target ||
      (row.chain.includes(target) &&
        !row.flags.some((flag) =>
          ["cycle", "dangling", "orphan-source"].includes(flag)
        ))
  );
}

function treeSignature(rows: ComposedRow[]): string {
  return rows
    .map(
      (row) => `${row.id}[${treeSignature(row.children)}]${row.flags.join(",")}`
    )
    .join("|");
}

function moveAnchorsOnce(rows: ComposedRow[]): ComposedRow[] {
  const anchoredRows = paths(
    rows,
    (row) =>
      row.node.extraAttrs?.front === "true" ||
      row.node.extraAttrs?.after !== undefined
  )
    .map((path) => at(rows, path))
    .sort((left, right) => left.claimOrder.localeCompare(right.claimOrder));

  return anchoredRows.reduce((current, original) => {
    const ownPaths = paths(current, (row) => row.id === original.id);
    if (ownPaths.length !== 1) {
      return current;
    }
    const ownPath = ownPaths[0];
    const row = at(current, ownPath);
    if (row.node.extraAttrs?.front === "true") {
      const without = replace(current, ownPath, []);
      return insertAtWrittenParent(without, withoutFlag(row, "lapsed"), true);
    }
    const anchor = row.node.extraAttrs?.after;
    if (anchor === undefined) {
      return current;
    }
    const scopedCandidates = targetPaths(current, anchor).filter((path) => {
      const candidate = at(current, path);
      return (
        candidate.scope === row.scope &&
        candidate.relevance !== "not_relevant" &&
        path.join(",") !== ownPath.join(",") &&
        !ownPath.every((value, index) => path[index] === value)
      );
    });
    const siblingCandidates = scopedCandidates.filter(
      (path) => at(current, path).writtenParent === row.writtenParent
    );
    const baseCandidates = scopedCandidates.filter((path) => {
      const candidate = at(current, path);
      return !candidate.reader && candidate.flags.length === 0;
    });
    const candidates = (() => {
      if (siblingCandidates.length > 0) {
        return siblingCandidates;
      }
      return baseCandidates.length > 0 ? baseCandidates : scopedCandidates;
    })();
    if (candidates.length !== 1) {
      const flag = candidates.length > 1 ? "ambiguous-anchor" : "lapsed";
      return replace(current, ownPath, [withFlag(row, flag)]);
    }
    const anchorPath = candidates[0];
    const alreadyAfter =
      ownPath.length === anchorPath.length &&
      ownPath
        .slice(0, -1)
        .every((value, index) => value === anchorPath[index]) &&
      ownPath[ownPath.length - 1] === anchorPath[anchorPath.length - 1] + 1;
    if (alreadyAfter) {
      return replace(current, ownPath, [withoutFlag(row, "lapsed")]);
    }
    const without = replace(current, ownPath, []);
    const shiftedAnchor = anchorPath.map((value, index) => {
      const sameParent = ownPath
        .slice(0, -1)
        .every((part, partIndex) => part === anchorPath[partIndex]);
      return sameParent &&
        index === anchorPath.length - 1 &&
        ownPath[ownPath.length - 1] < value
        ? value - 1
        : value;
    });
    return insertAfter(without, shiftedAnchor, withoutFlag(row, "lapsed"));
  }, rows);
}

function relocateAnchors(rows: ComposedRow[]): ComposedRow[] {
  const visit = (
    current: ComposedRow[],
    seen: globalThis.Set<string>
  ): ComposedRow[] => {
    const signature = treeSignature(current);
    if (seen.has(signature)) {
      return current;
    }
    const next = moveAnchorsOnce(current);
    const nextSignature = treeSignature(next);
    if (nextSignature === signature) {
      return next;
    }
    return visit(next, new globalThis.Set([...seen, signature]));
  };
  return visit(rows, new globalThis.Set<string>());
}

function applyLayer(
  graph: GraphLookup,
  rootRef: NodeRef,
  base: ComposedRow[],
  owner: ResolvedNode,
  active: ID[],
  scope: ID,
  order: string,
  resolve: (
    resolved: ResolvedNode,
    activePath: ID[],
    rowScope: ID,
    rowOrder: string,
    writtenParent: ID | undefined
  ) => ComposedRow
): ComposedRow[] {
  const claims = owner.node.children
    .toArray()
    .filter((id) => id !== EMPTY_NODE_ID)
    .flatMap((id, index) => {
      const resolved = getNodeInSource(graph, {
        sourceId: owner.ref.sourceId,
        id,
      });
      return resolved
        ? [
            {
              resolved,
              order: `${order}.${index.toString().padStart(8, "0")}`,
            },
          ]
        : [];
    });

  const layered = claims.reduce((current, entry) => {
    const claim = entry.resolved;
    if (!projects(claim.node)) {
      return [
        ...current,
        resolve(claim, active, scope, entry.order, owner.node.id),
      ];
    }
    const target = targetOf(claim.node);
    const matches = target === undefined ? [] : targetPaths(current, target);
    const sourcePath = matches.length === 1 ? matches[0] : undefined;
    const matched = sourcePath ? at(current, sourcePath) : undefined;
    const sourceResolved = (() => {
      if (matched && !matched.reader) {
        return { ref: matched.ref, node: matched.node };
      }
      return target === undefined
        ? undefined
        : lookupNode(graph, target, claim.ref.sourceId);
    })();
    const source = (() => {
      if (matched && !matched.reader) {
        return matched;
      }
      return sourceResolved
        ? resolve(sourceResolved, active, scope, entry.order, owner.node.id)
        : undefined;
    })();
    const ownMarker = marker(claim.node, source);
    const kind = rowKind(claim.node);
    const text =
      kind === "speaking"
        ? effectiveText(claim.node)
        : source?.text ?? frozenText(claim.node);
    const view: ComposedRow = {
      id: claim.node.id,
      ref: claim.ref,
      node: claim.node,
      reader: isReaderRow(claim, rootRef),
      kind,
      target,
      chain: [claim.node.id, ...(source?.chain ?? (target ? [target] : []))],
      text,
      relevance: ownMarker.relevance,
      argument: ownMarker.argument,
      flags: degradationFlags(
        kind,
        false,
        target !== undefined && sourceResolved === undefined,
        source
      ),
      drift:
        kind === "placement" &&
        source !== undefined &&
        frozenText(claim.node) !== source.text
          ? { frozen: frozenText(claim.node), current: source.text }
          : undefined,
      children: applyLayer(
        graph,
        rootRef,
        source?.children ?? [],
        claim,
        [...active, claim.node.id],
        scope,
        entry.order,
        resolve
      ),
      scope,
      writeParent: scope,
      writtenParent: owner.node.id,
      sourceParent: matched?.sourceParent,
      claimOrder: entry.order,
    };
    if (!sourcePath) {
      return [...current, view];
    }
    if (!anchored(claim.node) || sourcePath.length === 1) {
      if (matched?.reader) {
        return insertAfter(current, sourcePath, view);
      }
      return replace(current, sourcePath, [view]);
    }
    const without = matched?.reader
      ? current
      : replace(current, sourcePath, []);
    return [...without, view];
  }, base);

  return relocateAnchors(layered);
}

function resolveRow(
  graph: GraphLookup,
  rootRef: NodeRef,
  resolved: ResolvedNode,
  active: ID[],
  scope: ID,
  order: string,
  writtenParent: ID | undefined
): ComposedRow {
  const { node } = resolved;
  const kind = rowKind(node);
  const reader = isReaderRow(resolved, rootRef);
  const target = targetOf(node);
  const repeated = active.includes(node.id);
  const nextScope =
    reader && projects(node) && scope === rootRef.id ? node.id : scope;
  const baseRow = (): ComposedRow | undefined => {
    if (
      repeated ||
      !projects(node) ||
      target === undefined ||
      active.includes(target)
    ) {
      return undefined;
    }
    const targetRow = lookupNode(graph, target, resolved.ref.sourceId);
    return targetRow
      ? resolveRow(
          graph,
          rootRef,
          targetRow,
          [...active, node.id],
          nextScope,
          order,
          writtenParent
        )
      : undefined;
  };
  const source = baseRow();
  const cycle =
    repeated ||
    (projects(node) && target !== undefined && active.includes(target));
  const missing = projects(node) && target !== undefined && !source && !cycle;
  const ownMarker = marker(node, source);
  const directChildren = (repeated ? List<ID>() : node.children)
    .toArray()
    .filter((id) => id !== EMPTY_NODE_ID)
    .flatMap((id, index) => {
      const child = getNodeInSource(graph, {
        sourceId: resolved.ref.sourceId,
        id,
      });
      return child
        ? [
            resolveRow(
              graph,
              rootRef,
              child,
              [...active, node.id],
              nextScope,
              `${order}.${index.toString().padStart(8, "0")}`,
              node.id
            ),
          ]
        : [];
    });
  const children = (() => {
    if (repeated) {
      return [];
    }
    if (!projects(node)) {
      return relocateAnchors(directChildren);
    }
    return applyLayer(
      graph,
      rootRef,
      source?.children ?? [],
      resolved,
      [...active, node.id],
      nextScope,
      order,
      (child, activePath, rowScope, rowOrder, parent) =>
        resolveRow(
          graph,
          rootRef,
          child,
          activePath,
          rowScope,
          rowOrder,
          parent
        )
    );
  })();
  const sourceParent =
    source?.sourceParent ??
    (node.parent === undefined
      ? undefined
      : { sourceId: resolved.ref.sourceId, id: node.parent });
  return {
    id: node.id,
    ref: resolved.ref,
    node,
    reader,
    kind,
    target,
    chain: [node.id, ...(source?.chain ?? (target ? [target] : []))],
    text:
      kind === "speaking"
        ? effectiveText(node)
        : source?.text ?? frozenText(node),
    relevance: ownMarker.relevance,
    argument: ownMarker.argument,
    flags: degradationFlags(kind, cycle, missing, source),
    drift:
      kind === "placement" &&
      source !== undefined &&
      frozenText(node) !== source.text
        ? { frozen: frozenText(node), current: source.text }
        : undefined,
    children,
    scope: nextScope,
    writeParent: nextScope,
    writtenParent,
    sourceParent,
    claimOrder: order,
  };
}

function stub(ref: NodeRef): ComposedRow {
  const node: GraphNode = {
    children: List<ID>(),
    id: ref.id,
    spans: plainSpans(ref.id),
    updated: 0,
    root: ref.id,
    relevance: undefined,
  };
  return {
    id: ref.id,
    ref,
    node,
    reader: false,
    kind: "own",
    target: undefined,
    chain: [ref.id],
    text: ref.id,
    relevance: undefined,
    argument: undefined,
    flags: ["dangling"],
    drift: undefined,
    children: [],
    scope: ref.id,
    writeParent: ref.id,
    writtenParent: undefined,
    sourceParent: undefined,
    claimOrder: "",
  };
}

function descendantPlacementTargets(row: ComposedRow): ID[] {
  return row.children.flatMap((child) => [
    ...(child.reader &&
    (child.kind === "placement" || child.kind === "speaking") &&
    child.target !== undefined &&
    child.argument === undefined
      ? [child.target]
      : []),
    ...descendantPlacementTargets(child),
  ]);
}

function prunePlacementTargets(
  row: ComposedRow,
  targets: globalThis.Set<ID>
): ComposedRow {
  return {
    ...row,
    children: row.children
      .filter(
        (child) =>
          child.reader ||
          ![...targets].some(
            (target) => child.id === target || child.chain.includes(target)
          )
      )
      .map((child) =>
        child.reader &&
        (child.kind === "placement" || child.kind === "speaking")
          ? child
          : prunePlacementTargets(child, targets)
      ),
  };
}

function consumePlacementTargets(row: ComposedRow): ComposedRow {
  const composed = {
    ...row,
    children: row.children.map(consumePlacementTargets),
  };
  if (
    !composed.reader ||
    (composed.kind !== "placement" && composed.kind !== "speaking")
  ) {
    return composed;
  }
  const targets = new globalThis.Set(descendantPlacementTargets(composed));
  return targets.size === 0
    ? composed
    : prunePlacementTargets(composed, targets);
}

function externalTargets(row: ComposedRow, insidePlacement: boolean): ID[] {
  const projecting = row.kind === "placement" || row.kind === "speaking";
  return [
    ...(row.reader && projecting && !insidePlacement && row.target
      ? [row.target]
      : []),
    ...row.children.flatMap((child) =>
      externalTargets(child, insidePlacement || projecting)
    ),
  ];
}

function pruneExternalTargets(
  row: ComposedRow,
  targets: globalThis.Set<ID>
): ComposedRow {
  return {
    ...row,
    children: row.children
      .filter(
        (child) =>
          child.reader ||
          ![...targets].some(
            (target) => child.id === target || child.chain.includes(target)
          )
      )
      .map((child) => pruneExternalTargets(child, targets)),
  };
}

function consumeExternalTargets(root: ComposedRow): ComposedRow {
  const targets = new globalThis.Set(
    root.children.flatMap((child) => externalTargets(child, false))
  );
  return targets.size === 0 ? root : pruneExternalTargets(root, targets);
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

function collectClaims(row: ComposedRow): CompositionResult["claims"] {
  return [
    ...(row.reader
      ? [
          {
            id: row.id,
            target: row.target,
            relevance: row.node.relevance,
            argument: row.node.argument,
            context: row.scope,
            parent: row.writtenParent,
          },
        ]
      : []),
    ...row.children.flatMap(collectClaims),
  ];
}

function collectDiagnostics(
  row: ComposedRow,
  seen: globalThis.Set<string>
): CompositionResult["diagnostics"] {
  const own = [
    ...row.flags.map((code) => ({ code, rowId: row.id })),
    ...(row.drift ? [{ code: "drift", rowId: row.id }] : []),
  ].filter(({ code, rowId }) => {
    const key = `${code}:${rowId}`;
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

export function composeNote(
  graph: GraphLookup,
  rootRef: NodeRef
): CompositionResult {
  const root = getNodeInSource(graph, rootRef);
  if (!root) {
    return { root: stub(rootRef), claims: [], diagnostics: [] };
  }
  const composed = assignWriteParents(
    consumeExternalTargets(
      consumePlacementTargets(
        resolveRow(graph, rootRef, root, [], rootRef.id, "00000000", undefined)
      )
    ),
    rootRef.id
  );
  return {
    root: composed,
    claims: collectClaims(composed),
    diagnostics: collectDiagnostics(composed, new globalThis.Set<string>()),
  };
}

function markerText(relevance: Relevance, argument: Argument): string {
  const prefix = formatPrefixMarkers(relevance, argument);
  return prefix === "" ? "" : prefix.replace("(", "{").replace(")", "}");
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
