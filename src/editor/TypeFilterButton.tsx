import React from "react";
import { useMediaQuery } from "react-responsive";
import { Dropdown } from "react-bootstrap";
import { planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../core/constants";
import { IS_SMALL_SCREEN } from "./responsive";

const RELEVANCE_FILTERS: {
  id: Relevance | "contains";
  label: string;
  color: string;
  symbol: string;
}[] = [
  {
    id: "relevant",
    label: "Relevant",
    color: TYPE_COLORS.relevant,
    symbol: "!",
  },
  {
    id: "maybe_relevant",
    label: "Maybe Relevant",
    color: TYPE_COLORS.maybe_relevant,
    symbol: "?",
  },
  {
    id: "little_relevant",
    label: "Little Relevant",
    color: TYPE_COLORS.little_relevant,
    symbol: "~",
  },
  {
    id: "not_relevant",
    label: "Not Relevant",
    color: TYPE_COLORS.not_relevant,
    symbol: "x",
  },
  {
    id: "contains",
    label: "Contains",
    color: TYPE_COLORS.contains,
    symbol: "o",
  },
];

const SUGGESTIONS_FILTER = {
  id: "suggestions" as const,
  label: "Suggestions",
  color: TYPE_COLORS.other_user,
  symbol: "@",
};

const VERSIONS_FILTER = {
  id: "versions" as const,
  label: "Versions",
  color: TYPE_COLORS.other_user,
  symbol: "\u2225",
};

const INCOMING_FILTER = {
  id: "incoming" as const,
  label: "Incoming",
  color: TYPE_COLORS.referenced_by,
  symbol: "R",
};

export type FilterId =
  | Relevance
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains";

export function useToggleFilter(): (id: FilterId) => void {
  const pane = useCurrentPane();
  const { panes } = useData();
  const { createPlan, executePlan } = usePlanner();

  return (id: FilterId): void => {
    const currentFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;
    const isActive = currentFilters.includes(id);
    const newFilters: FilterId[] = isActive
      ? currentFilters.filter((f) => f !== id)
      : [...currentFilters, id];
    const updatedPane = { ...pane, typeFilters: newFilters };
    const newPanes = panes.map((p) => (p.id === pane.id ? updatedPane : p));
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };
}

function ClickableFilterSymbol({
  id,
  label,
  color,
  symbol,
  isActive,
  onClick,
}: {
  id: FilterId;
  label: string;
  color: string;
  symbol: string;
  isActive: boolean;
  onClick: (id: FilterId) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="clickable-filter-symbol"
      style={{ color: isActive ? color : TYPE_COLORS.inactive }}
      onClick={() => onClick(id)}
      aria-label={`toggle ${label} filter`}
      aria-pressed={isActive}
      title={label}
    >
      {symbol}
    </button>
  );
}

const ALL_FILTERS = [
  ...RELEVANCE_FILTERS,
  SUGGESTIONS_FILTER,
  VERSIONS_FILTER,
  INCOMING_FILTER,
];

function FilterPopover({
  currentFilters,
  onToggle,
}: {
  currentFilters: FilterId[];
  onToggle: (id: FilterId) => void;
}): JSX.Element {
  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);
  return (
    <Dropdown className="filter-popover">
      <Dropdown.Toggle
        as="button"
        className="btn btn-icon"
        aria-label="open filter menu"
      >
        ∇
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <div className="filter-popover-symbols">
          {ALL_FILTERS.map((f) => (
            <ClickableFilterSymbol
              key={f.id}
              id={f.id}
              label={f.label}
              color={f.color}
              symbol={f.symbol}
              isActive={isFilterActive(f.id)}
              onClick={onToggle}
            />
          ))}
        </div>
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function InlineFilterDots(): JSX.Element {
  const isSmallScreen = useMediaQuery(IS_SMALL_SCREEN);
  const pane = useCurrentPane();
  const currentFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;
  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);
  const handleFilterToggle = useToggleFilter();

  if (isSmallScreen) {
    return (
      <FilterPopover
        currentFilters={currentFilters}
        onToggle={handleFilterToggle}
      />
    );
  }

  return (
    <div className="inline-filter-symbols">
      <span className="filter-group">
        {RELEVANCE_FILTERS.map((f) => (
          <ClickableFilterSymbol
            key={f.id}
            id={f.id}
            label={f.label}
            color={f.color}
            symbol={f.symbol}
            isActive={isFilterActive(f.id)}
            onClick={handleFilterToggle}
          />
        ))}
      </span>
      <ClickableFilterSymbol
        id={SUGGESTIONS_FILTER.id}
        label={SUGGESTIONS_FILTER.label}
        color={SUGGESTIONS_FILTER.color}
        symbol={SUGGESTIONS_FILTER.symbol}
        isActive={isFilterActive(SUGGESTIONS_FILTER.id)}
        onClick={handleFilterToggle}
      />
      <ClickableFilterSymbol
        id={VERSIONS_FILTER.id}
        label={VERSIONS_FILTER.label}
        color={VERSIONS_FILTER.color}
        symbol={VERSIONS_FILTER.symbol}
        isActive={isFilterActive(VERSIONS_FILTER.id)}
        onClick={handleFilterToggle}
      />
      <ClickableFilterSymbol
        id={INCOMING_FILTER.id}
        label={INCOMING_FILTER.label}
        color={INCOMING_FILTER.color}
        symbol={INCOMING_FILTER.symbol}
        isActive={isFilterActive(INCOMING_FILTER.id)}
        onClick={handleFilterToggle}
      />
    </div>
  );
}
