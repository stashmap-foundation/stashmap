import { updateView, useNodeID, useViewPath } from "../ViewContext";
import { useData } from "../DataContext";
import { planUpdateViews, usePlanner } from "../planner";

export function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const view = useNodeID()[1];

  return (expand: boolean): void => {
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        expanded: expand,
      })
    );
    executePlan(plan);
  };
}
