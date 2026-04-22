import { List } from "immutable";
import { v4 } from "uuid";
import { joinID } from "./connections";
import { createRootAnchor } from "./rootAnchor";

function newRootFrontMatter(): string {
  return `---\nknowstr_doc_id: ${v4()}\n---\n`;
}

export function newNode(
  text: string,
  semanticContext: Context,
  myself: PublicKey,
  root?: LongID,
  parent?: LongID,
  systemRole?: RootSystemRole
): GraphNode {
  const id = joinID(myself, v4());
  return {
    children: List<ID>(),
    id,
    text,
    parent,
    anchor: !parent ? createRootAnchor(semanticContext) : undefined,
    frontMatter: !parent ? newRootFrontMatter() : undefined,
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
  return {
    children: List<ID>(),
    id: joinID(myself, v4()),
    text: text || "",
    parent,
    updated: Date.now(),
    author: myself,
    root,
    relevance,
    argument,
    isRef: true,
    isCref: true,
    targetID,
    linkText,
  };
}
