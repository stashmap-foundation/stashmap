import React from "react";
import { planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

const RELEVANCE_FILTERS: {
  id: Relevance | "contains";
  label: string;
  color: string;
  symbol: string;
}[] = [
  { id: "relevant", label: "Relevant", color: TYPE_COLORS.relevant, symbol: "!" },
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
  { id: "contains", label: "Contains", color: TYPE_COLORS.contains, symbol: "o" },
];

const ARGUMENT_FILTERS: {
  id: "confirms" | "contra";
  label: string;
  color: string;
  symbol: string;
}[] = [
  { id: "confirms", label: "Confirms", color: TYPE_COLORS.confirms, symbol: "+" },
  { id: "contra", label: "Contradicts", color: TYPE_COLORS.contra, symbol: "-" },
];

const SUGGESTIONS_FILTER = {
  id: "suggestions" as const,
  label: "Suggestions",
  color: TYPE_COLORS.other_user,
  symbol: "@",
};

export type FilterId = Relevance | Argument | "suggestions" | "contains";

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

function FilterSymbol({
  color,
  symbol,
  isActive,
}: {
  color: string;
  symbol: string;
  isActive: boolean;
}): JSX.Element {
  return (
    <span
      className="filter-symbol"
      style={{ color: isActive ? color : TYPE_COLORS.inactive }}
    >
      {symbol}
    </span>
  );
}

export function FilterSymbolsDisplay({
  activeFilters,
}: {
  activeFilters: FilterId[];
}): JSX.Element {
  const isActive = (id: FilterId): boolean => activeFilters.includes(id);

  return (
    <span className="filter-symbols-display">
      {RELEVANCE_FILTERS.map((f) => (
        <FilterSymbol key={f.id} color={f.color} symbol={f.symbol} isActive={isActive(f.id)} />
      ))}
      {ARGUMENT_FILTERS.map((f) => (
        <FilterSymbol key={f.id} color={f.color} symbol={f.symbol} isActive={isActive(f.id)} />
      ))}
      <FilterSymbol color={SUGGESTIONS_FILTER.color} symbol={SUGGESTIONS_FILTER.symbol} isActive={isActive("suggestions")} />
    </span>
  );
}

export function TypeFilterButton(): JSX.Element {
  const pane = useCurrentPane();
  const currentFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  return (
    <button type="button" className="pill" aria-label="filter children by type">
      <FilterSymbolsDisplay activeFilters={currentFilters} />
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
    const isArgument = id === "confirms" || id === "contra";
    const isContains = id === "contains";

    const newFilters: FilterId[] = isActive
      ? currentFilters.filter((f) => f !== id)
      : (() => {
          if (isArgument) {
            return [...currentFilters.filter((f) => f !== "contains"), id];
          }
          if (isContains) {
            return [
              ...currentFilters.filter(
                (f) => f !== "confirms" && f !== "contra"
              ),
              id,
            ];
          }
          return [...currentFilters, id];
        })();

    const updatedPane = { ...pane, typeFilters: newFilters };
    const newPanes = panes.map((p) => (p.id === pane.id ? updatedPane : p));
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

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
      <span className="filter-group">
        {ARGUMENT_FILTERS.map((f) => (
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
    </div>
  );
}
