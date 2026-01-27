// Core constants with no dependencies to avoid circular imports
export const REFERENCED_BY = "referencedby" as LongID;
export const REF_PREFIX = "ref:";

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

// Colors for relevance and argument types
export const TYPE_COLORS = {
  relevant: "#0288d1",
  maybe_relevant: "#00acc1",
  little_relevant: "#26c6da",
  not_relevant: "#757575", // Gray for not relevant
  confirms: "#2e7d32",
  contra: "#c62828",
  other_user: "#d4826a", // Coral for other user's content badge
  other_user_bg: "#ffebe5", // Light coral/peach background for other user's content
  referenced_by: "#9c27b0", // Purple for Referenced By view
  inactive: "#d0d0d0",
};
