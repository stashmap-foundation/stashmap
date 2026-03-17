import { List } from "immutable";
import type { GraphPlan } from "../graph/commands";

export type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

export type Plan = WorkspacePlan;
