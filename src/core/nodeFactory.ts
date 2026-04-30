import { List } from "immutable";
import { v4 } from "uuid";
import { joinID } from "./connections";
import { createRootAnchor } from "./rootAnchor";
import { plainSpans, linkSpan, fileLinkSpan } from "./nodeSpans";

export function newNode(
  text: string,
  semanticContext: Context,
  myself: PublicKey,
  root?: LongID,
  parent?: LongID,
  systemRole?: RootSystemRole
): GraphNode {
  const id = joinID(myself, v4());
  const docId = !parent ? v4() : undefined;
  return {
    children: List<ID>(),
    id,
    spans: plainSpans(text),
    parent,
    anchor: !parent ? createRootAnchor(semanticContext) : undefined,
    docId,
    systemRole: !parent ? systemRole : undefined,
    updated: Date.now(),
    author: myself,
    root: root ?? id,
    relevance: undefined,
  };
}

export function newRefNode(
  myself: PublicKey,
  root: LongID,
  targetID: LongID,
  parent?: LongID,
  relevance?: Relevance,
  argument?: Argument,
  text?: string,
  linkText?: string
): GraphNode {
  const label = linkText || text || "";
  return {
    children: List<ID>(),
    id: joinID(myself, v4()),
    spans: [linkSpan(targetID, label)],
    parent,
    updated: Date.now(),
    author: myself,
    root,
    relevance,
    argument,
  };
}

export function newFileLinkNode(
  myself: PublicKey,
  root: LongID,
  path: string,
  parent?: LongID,
  relevance?: Relevance,
  argument?: Argument,
  text?: string
): GraphNode {
  return {
    children: List<ID>(),
    id: joinID(myself, v4()),
    spans: [fileLinkSpan(path, text || "")],
    parent,
    updated: Date.now(),
    author: myself,
    root,
    relevance,
    argument,
  };
}
