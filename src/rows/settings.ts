export const DEFAULT_TYPE_FILTERS: (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains"
)[] = [
  "relevant",
  "maybe_relevant",
  "contains",
  "suggestions",
  "versions",
  "incoming",
];

export const suggestionSettings = { maxSuggestions: 5 };
