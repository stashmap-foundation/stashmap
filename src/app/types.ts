import { List } from "immutable";
import type { GraphPlan } from "../graph/commands";
import type { Data, TemporaryEvent } from "../features/app-shell/types";
import type { TemporaryViewState } from "../session/types";

export type WorkspacePlan = GraphPlan &
  Pick<Data, "publishEventsStatus" | "views" | "panes"> & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

export type Plan = WorkspacePlan;
