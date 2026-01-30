// Core constants with no dependencies to avoid circular imports
export const REFERENCED_BY = "referencedby" as LongID;
export const REF_PREFIX = "ref:";
export const SEARCH_PREFIX = "~Search:";

// Default type filters for children view
// Relevance: "relevant", "" (maybe relevant) are ON by default
// Evidence: "confirms", "contra" are ON by default
// Suggestions from other users: ON by default
// OFF by default: "little_relevant", "not_relevant"
export const DEFAULT_TYPE_FILTERS: (Relevance | Argument | "suggestions")[] = [
  "relevant",
  "",
  "confirms",
  "contra",
  "suggestions",
];

// Solarized accent colors for relevance and argument types
export const TYPE_COLORS = {
  relevant: "#268bd2",     // Blue - primary, relevant
  maybe_relevant: "#2aa198", // Cyan - maybe relevant
  little_relevant: "#b58900", // Yellow - little relevant
  not_relevant: "#93a1a1", // Base01 - muted
  confirms: "#859900",     // Green - confirms, success
  contra: "#dc322f",       // Red - contra, errors
  other_user: "#cb4b16",   // Orange - other user content
  other_user_bg: "#cb4b1620", // Orange with transparency
  referenced_by: "#268bd2", // Blue - referenced by
  inactive: "#93a1a1",     // Base01 - visible on base02/base03
};
