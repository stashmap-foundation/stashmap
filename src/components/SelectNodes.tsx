import { planUpdateViews, updateView } from "../session/views";
import { useCurrentRowID, useRowPath } from "../features/tree/RowContext";
import { useData } from "../DataContext";
import { usePlanner } from "../planner";

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
