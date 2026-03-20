import { List, Map, OrderedMap } from "immutable";
import type { PublicKey } from "./identity";

export type Hash = string;
export type ID = string;
export type LongID = string;

export type Context = List<ID>;

export type Relevance =
  | "relevant"
  | "maybe_relevant"
  | "little_relevant"
  | "not_relevant"
  | undefined;

export type Argument = "confirms" | "contra" | undefined;

export type VirtualType = "suggestion" | "search" | "incoming" | "version";

export type DiffStatus = "computed" | "loading" | "unavailable";

export type VersionMeta = {
  updated: number;
  addCount: number;
  removeCount: number;
  snapshotDTag?: string;
  diffStatus: DiffStatus;
};

export type RootAnchor = {
  snapshotContext: Context;
  snapshotLabels?: string[];
  sourceAuthor?: PublicKey;
  sourceRootID?: ID;
  sourceNodeID?: ID;
  sourceParentNodeID?: ID;
};

export type RootSystemRole = "log";

export type GraphNode = {
  children: List<ID>;
  id: ID;
  text: string;
  parent?: LongID;
  anchor?: RootAnchor;
  systemRole?: RootSystemRole;
  userPublicKey?: PublicKey;
  snapshotDTag?: string;
  updated: number;
  author: PublicKey;
  basedOn?: LongID;
  root: ID;
  relevance: Relevance;
  argument?: Argument;
  virtualType?: VirtualType;
  isRef?: boolean;
  isCref?: boolean;
  targetID?: LongID;
  linkText?: string;
};

export type KnowledgeData = {
  nodes: Map<ID, GraphNode>;
};

export type KnowledgeDBs = Map<PublicKey, KnowledgeData>;

export type SemanticIndex = {
  nodeByID: globalThis.Map<LongID, GraphNode>;
  semantic: globalThis.Map<string, globalThis.Set<LongID>>;
  incomingCrefs: globalThis.Map<LongID, globalThis.Set<LongID>>;
  basedOnIndex: globalThis.Map<LongID, globalThis.Set<LongID>>;
};

export type NodeType = {
  color: string;
  label: string;
  invertedNodeLabel: string;
};

export type NodeTypes = OrderedMap<ID, NodeType>;

export const EMPTY_SEMANTIC_ID = "" as ID;

export type TextSeed = {
  id: ID;
  text: string;
};

export type RefTargetSeed = {
  targetID: LongID;
  linkText?: string;
};

export function newDB(): KnowledgeData {
  return {
    nodes: Map<ID, GraphNode>(),
  };
}
