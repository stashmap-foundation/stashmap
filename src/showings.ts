import { Set as ImmutableSet } from "immutable";
import { EMPTY_NODE_ID } from "./core/connections";
import { embeddedTarget, nodeText } from "./core/nodeSpans";
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
  openTargets: ImmutableSet<ID>
): Showing {
  const name = [...trail, resolved.node.id];
  const targetID = embeddedTarget(resolved.node);
  const childTrail = targetID === undefined ? trail : name;
  const cycle = targetID !== undefined && openTargets.has(targetID);
  const resolvedTarget =
    targetID !== undefined && !cycle
      ? lookupNode(graph, targetID, resolved.ref.sourceId)
      : undefined;
  const target = resolvedTarget
    ? buildShowing(
        graph,
        resolvedTarget,
        { kind: "target" },
        childTrail,
        openTargets.add(resolvedTarget.ref.id)
      )
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
              openTargets
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
  return buildShowing(
    graph,
    root,
    { kind: "root" },
    [],
    ImmutableSet([root.node.id])
  );
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

export function projectedChildShowings(
  target: Showing | undefined
): { owner: Showing; child: Showing }[] {
  if (!target) {
    return [];
  }
  return [
    ...projectedChildShowings(target.target),
    ...target.children.map((child) => ({ owner: target, child })),
  ];
}
