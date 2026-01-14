// Core constants with no dependencies to avoid circular imports
export const REFERENCED_BY = "referencedby" as LongID;
export const REF_PREFIX = "ref:";

// Default type filters for diff items (suggestions from other users)
// Relevance: "" (relevant), "maybe_relevant" are ON by default
// Evidence: "confirms", "contra" are ON by default
// OFF by default: "little_relevant", "not_relevant"
export const DEFAULT_TYPE_FILTERS: (Relevance | Argument)[] = [
  "",
  "maybe_relevant",
  "confirms",
  "contra",
];
