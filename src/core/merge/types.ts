import { Map as ImmutableMap } from "immutable";

// The merge kernel's contract (idea.md, The subscription law / One kernel,
// three clients). Everything here is pure data — the corpus fixtures pin
// these shapes byte-for-byte across implementations.

export type BaseState = {
  author: string;
  doc: string;
  // Content-addressed snapshot id of the base version this file last
  // absorbed. Opaque to the kernel; resolution happens through the
  // snapshot store handed in as input.
  snapshot: string;
};

export type MergeSuggestion =
  // Same property, both sides changed: yours stands, theirs surfaces.
  | { kind: "text"; node: string; theirs: string }
  | {
      kind: "judgment";
      node: string;
      theirs: { relevance?: Relevance; argument?: Argument };
    }
  // Both resorted the same parent: one suggestion on the parent.
  | { kind: "order"; parent: string }
  // Their addition under a shared parent (display modes only — in
  // subscribe mode additions fold straight into the file).
  | { kind: "add"; parent: string; node: string; theirs: string }
  // Both moved the same node to different parents (F3): yours stands,
  // one suggestion, pin on the node.
  | { kind: "move"; node: string; theirsParent: string }
  // Baseline-free / unresolvable-baseline text drift: count only, no
  // direction, never a proposal.
  | { kind: "drift"; node: string };

export type MergeDetached = {
  node: string;
  reason: "base-deleted";
};

export type MergeResult = {
  // The folded document, rendered markdown. Only in subscribe mode.
  merged?: string;
  // False when the fold is a byte-identical no-op: nothing to write,
  // nothing to republish, pointer unmoved.
  changed: boolean;
  suggestions: MergeSuggestion[];
  detached: MergeDetached[];
  // Node ids carrying an unresolved-conflict pin after this merge
  // (also visible as snapshot="…" attributes in `merged`).
  pins: string[];
};

export type SnapshotStore = Record<string, string>;

export type ParsedDoc = {
  nodes: ImmutableMap<string, GraphNode>;
  topIds: string[];
  frontMatter?: FrontMatter;
  docId: string;
};
