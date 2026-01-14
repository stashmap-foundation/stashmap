import React, { useState, useRef } from "react";
import { Overlay, Popover } from "react-bootstrap";
import { planUpdateViews, usePlanner } from "../planner";
import { updateView, useNode, useViewPath, useIsInReferencedByView } from "../ViewContext";
import { DEFAULT_TYPE_FILTERS, REFERENCED_BY, TYPE_COLORS } from "../constants";

// Filter type definitions with colors
// Column 1: Relevance types (blue spectrum)
const COL_1_FILTERS: { id: Relevance; label: string; color: string }[] = [
  { id: "", label: "Relevant", color: TYPE_COLORS.relevant },
  { id: "maybe_relevant", label: "Maybe Relevant", color: TYPE_COLORS.maybe_relevant },
  { id: "little_relevant", label: "Little Relevant", color: TYPE_COLORS.little_relevant },
  { id: "not_relevant", label: "Not Relevant", color: TYPE_COLORS.not_relevant },
];

// Column 2: Evidence types (exclude undefined from Argument)
const COL_2_FILTERS: { id: "confirms" | "contra"; label: string; color: string }[] = [
  { id: "confirms", label: "Confirms", color: TYPE_COLORS.confirms },
  { id: "contra", label: "Contradicts", color: TYPE_COLORS.contra },
];

function FilterDot({
  color,
  isActive,
}: {
  color: string;
  isActive: boolean;
}): JSX.Element {
  return (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: isActive ? color : TYPE_COLORS.inactive,
        margin: "1px",
      }}
    />
  );
}

function FilterItem({
  id,
  label,
  color,
  isActive,
  onClick,
}: {
  id: Relevance | Argument;
  label: string;
  color: string;
  isActive: boolean;
  onClick: (id: Relevance | Argument) => void;
}): JSX.Element {
  return (
    <div
      className="d-flex align-items-center gap-2 mb-1"
      style={{ fontSize: "0.85rem", cursor: "pointer" }}
      onClick={() => onClick(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: isActive ? color : TYPE_COLORS.inactive,
        }}
      />
      <span style={{ color: isActive ? "inherit" : "#999" }}>{label}</span>
    </div>
  );
}

export function TypeFilterButton(): JSX.Element | null {
  const [show, setShow] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [node, view] = useNode();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();

  if (!node) {
    return null;
  }

  // Don't show filter button in Referenced By mode (for root or items inside)
  if (view.relations === REFERENCED_BY || isInReferencedByView) {
    return null;
  }

  // Get current filters (default if not set)
  const currentFilters = view.typeFilters || DEFAULT_TYPE_FILTERS;

  const isFilterActive = (id: Relevance | Argument): boolean =>
    currentFilters.includes(id as Relevance | Argument);

  const handleFilterToggle = (id: Relevance | Argument): void => {
    const isActive = currentFilters.includes(id as Relevance | Argument);
    const newFilters = isActive
      ? currentFilters.filter((f) => f !== id)
      : [...currentFilters, id];

    const plan = createPlan();
    executePlan(
      planUpdateViews(
        plan,
        updateView(plan.views, viewPath, {
          ...view,
          typeFilters: newFilters,
        })
      )
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-borderless p-0"
        onClick={() => setShow(!show)}
        aria-label="filter suggestions"
        title="Filter suggestions from other users"
      >
        {/* Two columns of dots representing filter state */}
        <span className="d-flex gap-0" style={{ lineHeight: 1 }}>
          <span className="d-flex flex-column">
            {COL_1_FILTERS.map((f) => (
              <FilterDot
                key={f.id}
                color={f.color}
                isActive={isFilterActive(f.id)}
              />
            ))}
          </span>
          <span className="d-flex flex-column">
            {COL_2_FILTERS.map((f) => (
              <FilterDot
                key={f.id}
                color={f.color}
                isActive={isFilterActive(f.id)}
              />
            ))}
            {/* Padding dots to align columns */}
            <FilterDot color={TYPE_COLORS.inactive} isActive={false} />
            <FilterDot color={TYPE_COLORS.inactive} isActive={false} />
          </span>
        </span>
      </button>

      <Overlay
        target={buttonRef.current}
        show={show}
        placement="bottom"
        rootClose
        onHide={() => setShow(false)}
      >
        <Popover id="type-filter-popover">
          <Popover.Body>
            <div className="d-flex gap-4">
              {/* Column 1: Relevance filters */}
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

              {/* Column 2: Evidence filters */}
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
