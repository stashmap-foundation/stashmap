import React, { useState, useRef } from "react";
import { Overlay, Popover } from "react-bootstrap";
import { planUpdateViews, usePlanner } from "../planner";
import {
  updateView,
  useNode,
  useNodeID,
  useViewPath,
  useIsInReferencedByView,
  useDisplayText,
} from "../ViewContext";
import { isEmptyNodeID } from "../connections";
import { DEFAULT_TYPE_FILTERS, REFERENCED_BY, TYPE_COLORS } from "../constants";
import { preventEditorBlurIfSameNode } from "./AddNode";
import { useEditorText } from "./EditorTextContext";

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
    <span className="d-flex gap-0" style={{ lineHeight: 1 }}>
      <span className="d-flex flex-column">
        {COL_1_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
      </span>
      <span className="d-flex flex-column">
        {COL_2_FILTERS.map((f) => (
          <FilterDot key={f.id} color={f.color} isActive={isActive(f.id)} />
        ))}
        {/* Padding dot to align columns */}
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
      aria-label={`toggle ${label} filter`}
      aria-pressed={isActive}
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
  const [nodeID] = useNodeID();
  const versionedDisplayText = useDisplayText();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();
  const isEmptyNode = isEmptyNodeID(nodeID);
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";
  const displayText = editorText.trim() || versionedDisplayText;

  if (!node) {
    return null;
  }

  // Don't show filter button in Referenced By mode (for root or items inside)
  if (view.relations === REFERENCED_BY || isInReferencedByView) {
    return null;
  }

  // Show disabled filter button for empty nodes
  if (isEmptyNode) {
    return (
      <button
        type="button"
        className="btn btn-borderless p-0"
        onMouseDown={preventEditorBlurIfSameNode}
        disabled
        aria-label={`filter ${displayText}`}
        title="Save node first to filter"
        style={{ opacity: 0.4, cursor: "default" }}
      >
        <FilterDotsDisplay activeFilters={[]} />
      </button>
    );
  }

  // Get current filters (default if not set)
  const currentFilters = view.typeFilters || DEFAULT_TYPE_FILTERS;

  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);

  const handleFilterToggle = (id: FilterId): void => {
    const isActive = currentFilters.includes(id);
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
        aria-label={`filter ${displayText}`}
        title="Filter by relation type"
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
