import { List } from "immutable";
import { v4 } from "uuid";

export type NewGraphNodeOptions = {
  root?: ID;
  parent?: ID;
  docId?: string;
  relevance?: Relevance;
  argument?: Argument;
  systemRole?: RootSystemRole;
  uuid?: string;
};

function graphNodeId(uuid?: string): ID {
  return uuid ?? v4();
}

export function newGraphNode(
  myself: PublicKey,
  spans: InlineSpan[],
  options: NewGraphNodeOptions = {}
): GraphNode {
  const id = graphNodeId(options.uuid);
  const { parent } = options;
  const root = options.root ?? id;
  return {
    children: List<ID>(),
    id,
    spans,
    parent,
    ...(options.docId !== undefined ? { docId: options.docId } : {}),
    ...(options.systemRole !== undefined && !parent
      ? { systemRole: options.systemRole }
      : {}),
    updated: Date.now(),
    author: myself,
    root,
    relevance: options.relevance,
    ...(options.argument !== undefined ? { argument: options.argument } : {}),
  };
}
