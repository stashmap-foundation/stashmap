import { List } from "immutable";
import { v4 } from "uuid";
import { rowKey } from "./nodeRef";

export type NewGraphNodeOptions = {
  id: ID;
  root?: ID;
  parent?: ID;
  relevance?: Relevance;
  argument?: Argument;
  systemRole?: RootSystemRole;
};

export function newRowKey(path: string): ID {
  return rowKey(path, v4());
}

export function newGraphNode(
  spans: InlineSpan[],
  options: NewGraphNodeOptions
): GraphNode {
  const { id, parent } = options;
  const root = options.root ?? id;
  return {
    children: List<ID>(),
    id,
    spans,
    parent,
    ...(options.systemRole !== undefined && !parent
      ? { systemRole: options.systemRole }
      : {}),
    updated: Date.now(),
    root,
    relevance: options.relevance,
    ...(options.argument !== undefined ? { argument: options.argument } : {}),
  };
}
