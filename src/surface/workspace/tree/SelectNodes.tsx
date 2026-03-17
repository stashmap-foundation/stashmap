import { planUpdateViews, updateView } from "../../../session/views";
import { useCurrentRowID, useRowPath } from "./RowContext";
import { useData } from "../../app-shell/DataContext";
import { usePlanner } from "../../app-shell/PlannerContext";

export function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const rowPath = useRowPath();
  const view = useCurrentRowID()[1];

  return (expand: boolean): void => {
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, rowPath, {
        ...view,
        expanded: expand,
      })
    );
    executePlan(plan);
  };
}
