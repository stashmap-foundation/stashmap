import { List } from "immutable";
import { v4 } from "uuid";
import { createRootAnchor } from "./rootAnchor";

export type NewGraphNodeOptions = {
  root?: LongID;
  parent?: LongID;
  docId?: string;
  relevance?: Relevance;
  argument?: Argument;
  semanticContext?: Context;
  systemRole?: RootSystemRole;
  uuid?: string;
};

function graphNodeId(_myself: PublicKey, uuid?: string): LongID {
  return (uuid ?? v4()) as LongID;
}

export function newGraphNode(
  myself: PublicKey,
  spans: InlineSpan[],
  options: NewGraphNodeOptions = {}
): GraphNode {
  const id = graphNodeId(myself, options.uuid);
  const { parent } = options;
  const root = options.root ?? id;
  return {
    children: List<ID>(),
    id,
    spans,
    parent,
    ...(options.docId !== undefined ? { docId: options.docId } : {}),
    ...(options.semanticContext !== undefined && !parent
      ? { anchor: createRootAnchor(options.semanticContext) }
      : {}),
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
