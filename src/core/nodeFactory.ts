import { List } from "immutable";
import { v4 } from "uuid";
import { joinID } from "./connections";
import { createRootAnchor } from "./rootAnchor";
import { plainSpans, linkSpan, fileLinkSpan } from "./nodeSpans";

type NodeFactoryOptions = {
  uuid?: string;
};

function graphNodeId(myself: PublicKey, uuid?: string): LongID {
  return joinID(myself, uuid ?? v4());
}

function newGraphNode(
  myself: PublicKey,
  spans: InlineSpan[],
  options: {
    root?: LongID;
    parent?: LongID;
    docId?: string;
    relevance?: Relevance;
    argument?: Argument;
    semanticContext?: Context;
    systemRole?: RootSystemRole;
    uuid?: string;
  } = {}
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

export function newNode(
  text: string,
  semanticContext: Context,
  myself: PublicKey,
  root?: LongID,
  parent?: LongID,
  systemRole?: RootSystemRole,
  options: NodeFactoryOptions = {}
): GraphNode {
  const docId = !parent ? v4() : undefined;
  return newGraphNode(myself, plainSpans(text), {
    root,
    parent,
    docId,
    semanticContext,
    systemRole,
    uuid: options.uuid,
  });
}

export function newRefNode(
  myself: PublicKey,
  root: LongID,
  targetID: LongID,
  parent?: LongID,
  relevance?: Relevance,
  argument?: Argument,
  text?: string,
  linkText?: string,
  options: NodeFactoryOptions = {}
): GraphNode {
  const label = linkText || text || "";
  return newGraphNode(myself, [linkSpan(targetID, label)], {
    root,
    parent,
    relevance,
    argument,
    uuid: options.uuid,
  });
}

export function newFileLinkNode(
  myself: PublicKey,
  root: LongID,
  path: string,
  parent?: LongID,
  relevance?: Relevance,
  argument?: Argument,
  text?: string,
  options: NodeFactoryOptions = {}
): GraphNode {
  return newGraphNode(myself, [fileLinkSpan(path, text || "")], {
    root,
    parent,
    relevance,
    argument,
    uuid: options.uuid,
  });
}

export function newTopFileLinkNode(
  myself: PublicKey,
  docId: string,
  path: string,
  relevance?: Relevance,
  argument?: Argument,
  text?: string,
  options: NodeFactoryOptions = {}
): GraphNode {
  return newGraphNode(myself, [fileLinkSpan(path, text || "")], {
    docId,
    relevance,
    argument,
    uuid: options.uuid,
  });
}
