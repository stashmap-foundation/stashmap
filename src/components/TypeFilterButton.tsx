import React from "react";
import { useMediaQuery } from "react-responsive";
import { Dropdown } from "react-bootstrap";
import { planUpdatePanes, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import {
  ALL_NODE_KIND_FILTERS,
  DEFAULT_TYPE_FILTERS,
  TYPE_COLORS,
} from "../constants";
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

const NODE_KIND_FILTERS: {
  id: NodeKind;
  label: string;
}[] = [
  { id: "topic", label: "Themen" },
  { id: "author", label: "Autoren" },
  { id: "source", label: "Quellen" },
  { id: "statement", label: "Notizen" },
  { id: "task", label: "Tasks" },
];

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

function selectedNodeKindFilters(pane: Pane): NodeKind[] {
  return pane.nodeKindFilters ?? ALL_NODE_KIND_FILTERS;
}

function isDefaultNodeKindFilter(filters: NodeKind[]): boolean {
  return (
    filters.length === ALL_NODE_KIND_FILTERS.length &&
    ALL_NODE_KIND_FILTERS.every((kind) => filters.includes(kind))
  );
}

export function useToggleNodeKindFilter(): (kind: NodeKind) => void {
  const pane = useCurrentPane();
  const { panes } = useData();
  const { createPlan, executePlan } = usePlanner();

  return (kind: NodeKind): void => {
    const currentFilters = selectedNodeKindFilters(pane);
    const isActive = currentFilters.includes(kind);
    const nextFilters = isActive
      ? currentFilters.filter((filter) => filter !== kind)
      : [...currentFilters, kind];
    const updatedPane = {
      ...pane,
      nodeKindFilters: isDefaultNodeKindFilter(nextFilters)
        ? undefined
        : nextFilters,
    };
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

function NodeKindIcon({ kind }: { kind: NodeKind }): JSX.Element {
  if (kind === "topic") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 2.5h5L13.5 8l-5.5 5.5-5.5-5.5z" />
        <circle cx="6" cy="6" r="1.2" />
      </svg>
    );
  }
  if (kind === "author") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5" r="2.4" />
        <path d="M3.5 13c.7-2.5 2.2-3.8 4.5-3.8s3.8 1.3 4.5 3.8" />
      </svg>
    );
  }
  if (kind === "source") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 3.2h3.3c1 0 1.7.4 1.7 1.2V13c0-.8-.7-1.2-1.7-1.2H3z" />
        <path d="M13 3.2H9.7c-1 0-1.7.4-1.7 1.2V13c0-.8.7-1.2 1.7-1.2H13z" />
      </svg>
    );
  }
  if (kind === "task") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="3" width="10" height="10" rx="1.5" />
        <path d="M5.4 8.2 7.2 10l3.6-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h6l2 2V13.5H4z" />
      <path d="M10 2.5V5h2" />
      <path d="M6 8h4" />
      <path d="M6 10.5h4" />
    </svg>
  );
}

function NodeKindFilterButton({
  id,
  label,
  isActive,
  onClick,
}: {
  id: NodeKind;
  label: string;
  isActive: boolean;
  onClick: (id: NodeKind) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="clickable-filter-symbol node-kind-filter-symbol"
      style={{
        color: isActive ? TYPE_COLORS.referenced_by : TYPE_COLORS.inactive,
      }}
      onClick={() => onClick(id)}
      aria-label={`toggle ${label} node kind filter`}
      aria-pressed={isActive}
      title={label}
    >
      <NodeKindIcon kind={id} />
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
  currentNodeKindFilters,
  onNodeKindToggle,
}: {
  currentFilters: FilterId[];
  onToggle: (id: FilterId) => void;
  currentNodeKindFilters: NodeKind[];
  onNodeKindToggle: (id: NodeKind) => void;
}): JSX.Element {
  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);
  const isNodeKindActive = (id: NodeKind): boolean =>
    currentNodeKindFilters.includes(id);
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
          {NODE_KIND_FILTERS.map((filter) => (
            <NodeKindFilterButton
              key={filter.id}
              id={filter.id}
              label={filter.label}
              isActive={isNodeKindActive(filter.id)}
              onClick={onNodeKindToggle}
            />
          ))}
        </div>
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
  const currentNodeKindFilters = selectedNodeKindFilters(pane);
  const isFilterActive = (id: FilterId): boolean => currentFilters.includes(id);
  const isNodeKindActive = (id: NodeKind): boolean =>
    currentNodeKindFilters.includes(id);
  const handleFilterToggle = useToggleFilter();
  const handleNodeKindToggle = useToggleNodeKindFilter();

  if (isSmallScreen) {
    return (
      <FilterPopover
        currentFilters={currentFilters}
        onToggle={handleFilterToggle}
        currentNodeKindFilters={currentNodeKindFilters}
        onNodeKindToggle={handleNodeKindToggle}
      />
    );
  }

  return (
    <div className="inline-filter-symbols">
      <span className="filter-group">
        {NODE_KIND_FILTERS.map((filter) => (
          <NodeKindFilterButton
            key={filter.id}
            id={filter.id}
            label={filter.label}
            isActive={isNodeKindActive(filter.id)}
            onClick={handleNodeKindToggle}
          />
        ))}
      </span>
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
