import React, { useState, useRef } from "react";
import { Overlay, Popover } from "react-bootstrap";
import { planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

// Filter type definitions with colors
// Column 1: Relevance types (blue spectrum)
const COL_1_FILTERS: { id: Relevance; label: string; color: string }[] = [
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

// Column 2: Evidence types + Suggestions
const COL_2_FILTERS: {
  id: "confirms" | "contra" | "suggestions";
  label: string;
  color: string;
}[] = [
  { id: "confirms", label: "Confirms", color: TYPE_COLORS.confirms },
  { id: "contra", label: "Contradicts", color: TYPE_COLORS.contra },
  { id: "suggestions", label: "Suggestions", color: TYPE_COLORS.other_user },
];

export type FilterId = Relevance | Argument | "suggestions";

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

/**
 * Pure UI component that displays filter dots.
 * Pass activeFilters to show which are colored, empty array for all gray.
 */
export function FilterDotsDisplay({
  activeFilters,
}: {
  activeFilters: FilterId[];
}): JSX.Element {
  const isActive = (id: FilterId): boolean => activeFilters.includes(id);

  return (
    <span className="d-flex gap-0">
      <span className="d-flex flex-column">
        {COL_1_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
      </span>
      <span className="d-flex flex-column">
        {COL_2_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
        <FilterDot color={TYPE_COLORS.inactive} isActive={false} />
      </span>
    </span>
  );
}

function FilterItem({
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
  return (
    <div
      className="filter-item"
      onClick={() => onClick(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`toggle ${label} filter`}
      aria-pressed={isActive}
    >
      <span
        className="filter-dot filter-dot-large"
        style={{ backgroundColor: isActive ? color : TYPE_COLORS.inactive }}
      />
      <span className={isActive ? "" : "text-muted"}>{label}</span>
    </div>
  );
}

export function PaneFilterButton(): JSX.Element {
  const [show, setShow] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn"
        onClick={() => setShow(!show)}
        aria-label="filter pane"
        title="Filter by type"
      >
        <FilterDotsDisplay activeFilters={currentFilters} />
      </button>

      <Overlay
        target={buttonRef.current}
        show={show}
        placement="bottom"
        rootClose
        onHide={() => setShow(false)}
      >
        <Popover id="pane-filter-popover">
          <Popover.Body>
            <div className="d-flex gap-4">
              <div>
                {COL_1_FILTERS.map((f) => (
                  <FilterItem
                    key={f.id}
                    id={f.id}
                    label={f.label}
                    color={f.color}
                    isActive={isFilterActive(f.id)}
                    onClick={handleFilterToggle}
                  />
                ))}
              </div>
              <div>
                {COL_2_FILTERS.map((f) => (
                  <FilterItem
                    key={f.id}
                    id={f.id}
                    label={f.label}
                    color={f.color}
                    isActive={isFilterActive(f.id)}
                    onClick={handleFilterToggle}
                  />
                ))}
              </div>
            </div>
          </Popover.Body>
        </Popover>
      </Overlay>
    </>
  );
}
