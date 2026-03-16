import { Map, OrderedSet, Set } from "immutable";

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
