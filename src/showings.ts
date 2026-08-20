import { Set as ImmutableSet } from "immutable";
import { EMPTY_NODE_ID } from "./core/connections";
import { embeddedTarget, nodeText, spansToMarkdown } from "./core/nodeSpans";
import { accessibleLineText } from "./core/markdownTree";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  lookupNode,
} from "./core/graphLookup";

export type Showing = {
  node: GraphNode;
  ref: NodeRef;
  name: ID[];
  reached:
    | { kind: "root" }
    | { kind: "line"; childIndex: number }
    | { kind: "target" };
  target: Showing | undefined;
  cycle: boolean;
  children: Showing[];
};

function buildShowing(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  trail: ID[],
  openPath: ImmutableSet<ID>
): Showing {
  const name = [...trail, resolved.node.id];
  const path = openPath.add(resolved.node.id);
  const targetID = embeddedTarget(resolved.node);
  const childTrail = targetID === undefined ? trail : name;
  const cycle = targetID !== undefined && path.has(targetID);
  const resolvedTarget =
    targetID !== undefined && !cycle
      ? lookupNode(graph, targetID, resolved.ref.sourceId)
      : undefined;
  const target = resolvedTarget
    ? buildShowing(graph, resolvedTarget, { kind: "target" }, childTrail, path)
    : undefined;
  const children = resolved.node.children
    .toArray()
    .flatMap((childID, childIndex) => {
      if (childID === EMPTY_NODE_ID) {
        return [];
      }
      const child = getNodeInSource(graph, {
        sourceId: resolved.ref.sourceId,
        id: childID,
      });
      return child
        ? [
            buildShowing(
              graph,
              child,
              { kind: "line", childIndex },
              childTrail,
              path
            ),
          ]
        : [];
    });
  return {
    node: resolved.node,
    ref: resolved.ref,
    name,
    reached,
    target,
    cycle,
    children,
  };
}

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  return buildShowing(graph, root, { kind: "root" }, [], ImmutableSet());
}

export function presentedLineOf(showing: Showing): Showing {
  return showing.target ? presentedLineOf(showing.target) : showing;
}

export function standsForOf(showing: Showing): Row["standsFor"] {
  if (!showing.target) {
    return undefined;
  }
  return {
    id: showing.target.node.id,
    liveText: nodeText(presentedLineOf(showing.target).node),
  };
}

export function closesCycle(showing: Showing): boolean {
  return (
    showing.cycle || (showing.target ? closesCycle(showing.target) : false)
  );
}

export function leavesDangling(showing: Showing): boolean {
  const presented = presentedLineOf(showing);
  return (
    embeddedTarget(presented.node) !== undefined &&
    presented.target === undefined &&
    !presented.cycle
  );
}

export function linesShownThrough(
  target: Showing | undefined
): { source: Showing; line: Showing }[] {
  if (!target) {
    return [];
  }
  return [
    ...linesShownThrough(target.target),
    ...target.children.map((line) => ({ source: target, line })),
  ];
}

export type Drawn = {
  node: GraphNode;
  ref: NodeRef;
  name: ID[];
  projected: boolean;
  standsFor: Row["standsFor"];
  spans: InlineSpan[];
  cycle: boolean;
  dangling: boolean;
  place:
    | { kind: "root" }
    | { kind: "line"; childIndex: number }
    | { kind: "shown"; home: ResolvedNode };
  children: Drawn[];
};

function drawLine(
  showing: Showing,
  place: Drawn["place"],
  projected: boolean
): Drawn {
  const shown = linesShownThrough(showing.target).map(({ source, line }) =>
    drawLine(
      line,
      { kind: "shown", home: { node: source.node, ref: source.ref } },
      true
    )
  );
  const lines = showing.children.flatMap((line) =>
    line.reached.kind === "line"
      ? [
          drawLine(
            line,
            { kind: "line", childIndex: line.reached.childIndex },
            projected
          ),
        ]
      : []
  );
  return {
    node: showing.node,
    ref: showing.ref,
    name: showing.name,
    projected,
    standsFor: standsForOf(showing),
    spans: presentedLineOf(showing).node.spans,
    cycle: closesCycle(showing),
    dangling: leavesDangling(showing),
    place,
    children: [...shown, ...lines],
  };
}

export function drawShowing(root: Showing): Drawn {
  return drawLine(root, { kind: "root" }, false);
}

export function drawnText(drawn: Drawn): string {
  return accessibleLineText(spansToMarkdown(drawn.spans));
}
