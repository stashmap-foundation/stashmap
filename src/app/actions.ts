import { Plan, planUpsertNodes } from "../planner";
import { newNode } from "../nodeFactory";
import { getContext, getNodeForView, getParentNode } from "../rows/resolveRow";
import { type RowPath } from "../rows/rowPaths";

export function upsertNodes(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  modify: (nodes: GraphNode) => GraphNode
): Plan {
  const semanticContext = getContext(plan, rowPath, stack);
  const parentNode = getParentNode(plan, rowPath);
  const parentRoot = parentNode?.root;
  const currentNode = getNodeForView(plan, rowPath, stack);

  if (currentNode && currentNode.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's nodes");
  }

  const base =
    currentNode ||
    newNode(
      "",
      semanticContext,
      plan.user.publicKey,
      parentRoot,
      parentNode?.id
    );

  const updatedNodes = modify(base);

  if (currentNode && currentNode.children.equals(updatedNodes.children)) {
    return plan;
  }

  return planUpsertNodes(plan, updatedNodes);
}
