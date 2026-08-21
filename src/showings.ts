import { Set as ImmutableSet } from "immutable";
import { EMPTY_NODE_ID } from "./core/connections";
import { embeddedTarget } from "./core/nodeSpans";
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

/* eslint-disable functional/no-let, functional/immutable-data */
function chainFrames(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  trail: ID[],
  openPath: ImmutableSet<ID>
): {
  resolved: ResolvedNode;
  reached: Showing["reached"];
  name: ID[];
  path: ImmutableSet<ID>;
  childTrail: ID[];
  cycle: boolean;
}[] {
  const frames = [];
  let current = { resolved, reached, trail, openPath };
  for (;;) {
    const name = [...current.trail, current.resolved.node.id];
    const path = current.openPath.add(current.resolved.node.id);
    const targetID = embeddedTarget(current.resolved.node);
    const childTrail = targetID === undefined ? current.trail : name;
    const cycle = targetID !== undefined && path.has(targetID);
    frames.push({
      resolved: current.resolved,
      reached: current.reached,
      name,
      path,
      childTrail,
      cycle,
    });
    if (targetID === undefined || cycle) {
      return frames;
    }
    const target = lookupNode(graph, targetID, current.resolved.ref.sourceId);
    if (!target) {
      return frames;
    }
    current = {
      resolved: target,
      reached: { kind: "target" },
      trail: childTrail,
      openPath: path,
    };
  }
}
/* eslint-enable functional/no-let, functional/immutable-data */

function buildShowing(
  graph: GraphLookup,
  resolved: ResolvedNode,
  reached: Showing["reached"],
  trail: ID[],
  openPath: ImmutableSet<ID>
): Showing {
  const frames = chainFrames(graph, resolved, reached, trail, openPath);
  const lineChildren = (
    frame: typeof frames[number],
    openedBelow: ID[]
  ): Showing[] => {
    const linePath = frame.path.union(openedBelow);
    return frame.resolved.node.children
      .toArray()
      .flatMap((childID, childIndex) => {
        if (childID === EMPTY_NODE_ID) {
          return [];
        }
        const child = getNodeInSource(graph, {
          sourceId: frame.resolved.ref.sourceId,
          id: childID,
        });
        return child
          ? [
              buildShowing(
                graph,
                child,
                { kind: "line", childIndex },
                frame.childTrail,
                linePath
              ),
            ]
          : [];
      });
  };
  const frameShowing = (
    frame: typeof frames[number],
    target: Showing | undefined,
    openedBelow: ID[]
  ): Showing => ({
    node: frame.resolved.node,
    ref: frame.resolved.ref,
    name: frame.name,
    reached: frame.reached,
    target,
    cycle: frame.cycle,
    children: lineChildren(frame, openedBelow),
  });
  const last = frames[frames.length - 1];
  return frames.slice(0, -1).reduceRight(
    (inner, frame, index) =>
      frameShowing(
        frame,
        inner,
        frames.slice(index + 1).map((below) => below.resolved.node.id)
      ),
    frameShowing(last, undefined, [])
  );
}

export function showingTreeForRoot(
  graph: GraphLookup,
  root: ResolvedNode
): Showing {
  return buildShowing(graph, root, { kind: "root" }, [], ImmutableSet());
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
    embeddedTarget(presented.node) !== undefined &&
    presented.target === undefined &&
    !presented.cycle
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
