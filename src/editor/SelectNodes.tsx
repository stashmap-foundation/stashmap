import { updateRowView, useRow } from "../rowModel";
import { useData } from "../DataContext";
import { planUpdateViews, usePlanner } from "../planner";

export function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const row = useRow();

  return (expand: boolean): void => {
    const plan = planUpdateViews(
      createPlan(),
      updateRowView(data.views, row, {
        ...row.view,
        expanded: expand,
      })
    );
    executePlan(plan);
  };
}
