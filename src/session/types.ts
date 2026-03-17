import { Map, OrderedSet, Set } from "immutable";

export type TypeFilter =
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains";

export type Pane = {
  id: string;
  stack: ID[];
  author: PublicKey;
  rootNodeId?: ID;
  searchQuery?: string;
  typeFilters?: TypeFilter[];
  scrollToId?: string;
};

export type View = {
  expanded?: boolean;
  typeFilters?: TypeFilter[];
};

export type Views = Map<string, View>;

export type RowFocusIntent = {
  requestId: number;
  paneIndex: number;
  viewKey?: string;
  nodeId?: string;
  rowIndex?: number;
};

export type TemporaryViewState = {
  rowFocusIntents: Map<number, RowFocusIntent>;
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
  editingViews: Set<string>;
  editorOpenViews: Set<string>;
  draftTexts: Map<string, string>;
};
