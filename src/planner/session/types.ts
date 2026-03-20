import { List } from "immutable";
import type { GraphPlan } from "../../graph/commands";
import type {
  Pane,
  TemporaryEvent,
  TemporaryViewState,
  Views,
} from "../../session/types";
import type { SemanticIndex } from "../../graph/types";

export type WorkspacePlan = GraphPlan & {
  semanticIndex: SemanticIndex;
  publishEventsStatus: {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };
  views: Views;
  panes: Pane[];
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
};

export type Plan = WorkspacePlan;
