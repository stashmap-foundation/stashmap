import type { List, Map } from "immutable";
import type { Contacts, PublicKey, User } from "../graph/identity";
import type {
  Argument,
  GraphNode,
  ID,
  KnowledgeDBs,
  LongID,
  Relevance,
  SemanticIndex,
} from "../graph/types";

type RowsSnapshotRecord = {
  replaceableKey: string;
  author: PublicKey;
  dTag: string;
  eventId: string;
  sourceRootShortID: string;
  createdAt: number;
  updatedMs: number;
  content: string;
  tags: string[][];
};

export type RowTypeFilter =
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains";

export type RowPane = {
  author: PublicKey;
  rootNodeId?: ID;
  typeFilters?: RowTypeFilter[];
};

export type RowView = {
  expanded?: boolean;
  typeFilters?: RowTypeFilter[];
};

export type RowViews = Map<string, RowView>;

export type RowsTemporaryEvent =
  | {
      type: "ADD_EMPTY_NODE";
      nodeID: LongID;
      index: number;
      emptyNode: GraphNode;
      paneIndex: number;
    }
  | { type: "REMOVE_EMPTY_NODE"; nodeID: LongID };

export type RowsData = {
  contacts: Contacts;
  user: User;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  snapshots?: Map<string, RowsSnapshotRecord>;
  snapshotStatuses?: Map<string, "loading" | "loaded" | "unavailable">;
  publishEventsStatus: {
    temporaryEvents: List<RowsTemporaryEvent>;
  };
  views: RowViews;
  panes: RowPane[];
};
