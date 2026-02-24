// Core constants with no dependencies to avoid circular imports
export const REFERENCED_BY = "referencedby" as LongID;
export const SEARCH_PREFIX = "~Search:";

// Default type filters for children view
// Relevance filters: show relevant, maybe_relevant, and contains by default
// little_relevant and not_relevant are hidden by default
// Contains: items with undefined relevance and undefined argument
// Suggestions from other users: ON by default
export const DEFAULT_TYPE_FILTERS: (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "occurrence"
  | "contains"
)[] = [
  "relevant",
  "maybe_relevant",
  "contains",
  "suggestions",
  "versions",
  "incoming",
  "occurrence",
];

export const suggestionSettings = { maxSuggestions: 5 };

// Solarized accent colors for relevance and argument types
export const TYPE_COLORS = {
  relevant: "#268bd2", // Blue - primary, relevant
  maybe_relevant: "#d33682", // Magenta - maybe relevant
  little_relevant: "#b58900", // Yellow - little relevant
  not_relevant: "#93a1a1", // Base01 - muted
  contains: "#cb4b16", // Orange - contains/default
  confirms: "#859900", // Green - confirms, success
  contra: "#dc322f", // Red - contra, errors
  other_user: "#6c71c4", // Violet - other user content
  other_user_bg: "#6c71c420", // Violet with transparency
  referenced_by: "#2aa198", // Cyan - referenced by
  inactive: "#586e75", // Base01 (darker) - clearly dimmed
};
