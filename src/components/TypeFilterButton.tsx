import React from "react";
import { planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

const RELEVANCE_FILTERS: { id: Relevance; label: string; color: string }[] = [
  { id: "relevant", label: "Relevant", color: TYPE_COLORS.relevant },
  { id: "", label: "Maybe Relevant", color: TYPE_COLORS.maybe_relevant },
  {
    id: "little_relevant",
    label: "Little Relevant",
    color: TYPE_COLORS.little_relevant,
  },
  {
    id: "not_relevant",
    label: "Not Relevant",
    color: TYPE_COLORS.not_relevant,
  },
];

const ARGUMENT_FILTERS: {
  id: "confirms" | "contra";
  label: string;
  color: string;
}[] = [
  { id: "confirms", label: "Confirms", color: TYPE_COLORS.confirms },
  { id: "contra", label: "Contradicts", color: TYPE_COLORS.contra },
];

const SUGGESTIONS_FILTER = {
  id: "suggestions" as const,
  label: "Suggestions",
  color: TYPE_COLORS.other_user,
};

export type FilterId = Relevance | Argument | "suggestions";

function ClickableFilterDot({
  id,
  label,
  color,
  isActive,
  onClick,
}: {
  id: FilterId;
  label: string;
  color: string;
  isActive: boolean;
  onClick: (id: FilterId) => void;
}): JSX.Element {
  const style = isActive
    ? { backgroundColor: color, borderColor: color }
    : { backgroundColor: "transparent", borderColor: TYPE_COLORS.inactive };

  return (
    <button
      type="button"
      className="clickable-filter-dot"
      style={style}
      onClick={() => onClick(id)}
      aria-label={`toggle ${label} filter`}
      aria-pressed={isActive}
      title={label}
    />
  );
}

function FilterDot({
  color,
  isActive,
}: {
  color: string;
  isActive: boolean;
}): JSX.Element {
  return (
    <span
      className="filter-dot"
      style={{ backgroundColor: isActive ? color : TYPE_COLORS.inactive }}
    />
  );
}

export function FilterDotsDisplay({
  activeFilters,
}: {
  activeFilters: FilterId[];
}): JSX.Element {
  const isActive = (id: FilterId): boolean => activeFilters.includes(id);

  return (
    <span className="d-flex gap-0">
      <span className="d-flex flex-column">
        {RELEVANCE_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
      </span>
      <span className="d-flex flex-column">
        {ARGUMENT_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
        <FilterDot color={TYPE_COLORS.inactive} isActive={false} />
      </span>
    </span>
  );
}

export function TypeFilterButton(): JSX.Element {
  const pane = useCurrentPane();
  const currentFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  return (
    <button type="button" className="pill" aria-label="filter children by type">
      <FilterDotsDisplay activeFilters={currentFilters} />
    </button>
  );
}

export function InlineFilterDots(): JSX.Element {
  const pane = useCurrentPane();
  const { panes } = useData();
  const { createPlan, executePlan } = usePlanner();

  const currentFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);

  const handleFilterToggle = (id: FilterId): void => {
    const isActive = currentFilters.includes(id);
    const newFilters = isActive
      ? currentFilters.filter((f) => f !== id)
      : [...currentFilters, id];

    const updatedPane = { ...pane, typeFilters: newFilters };
    const newPanes = panes.map((p) => (p.id === pane.id ? updatedPane : p));
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

  return (
    <div className="inline-filter-dots">
      <span className="filter-group">
        {RELEVANCE_FILTERS.map((f) => (
          <ClickableFilterDot
            key={f.id}
            id={f.id}
            label={f.label}
            color={f.color}
            isActive={isFilterActive(f.id)}
            onClick={handleFilterToggle}
          />
        ))}
      </span>
      <span className="filter-group">
        {ARGUMENT_FILTERS.map((f) => (
          <ClickableFilterDot
            key={f.id}
            id={f.id}
            label={f.label}
            color={f.color}
            isActive={isFilterActive(f.id)}
            onClick={handleFilterToggle}
          />
        ))}
      </span>
      <ClickableFilterDot
        id={SUGGESTIONS_FILTER.id}
        label={SUGGESTIONS_FILTER.label}
        color={SUGGESTIONS_FILTER.color}
        isActive={isFilterActive(SUGGESTIONS_FILTER.id)}
        onClick={handleFilterToggle}
      />
    </div>
  );
}
