import { Map } from "immutable";
import type {
  Context,
  ID,
  VersionMeta,
  GraphNode,
  Relevance,
  Argument,
} from "../graph/types";
import type { PublicKey } from "../graph/identity";

export type VirtualRowsMap = Map<string, GraphNode>;

export type ReferenceRow = {
  id: ID;
  type: "reference";
  text: string;
  targetContext: Context;
  contextLabels: string[];
  targetLabel: string;
  author: PublicKey;
  incomingRelevance?: Relevance;
  incomingArgument?: Argument;
  displayAs?: "bidirectional" | "incoming";
  versionMeta?: VersionMeta;
  deleted?: boolean;
};
