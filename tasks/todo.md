# Query Speed Optimization

## Phase 1: Diagnostics
- [x] Add diagnostic logging to `useEventQuery` onevent/oneose callbacks
  - Logs total event count per subscription, broken down by kind
  - Logs the filters used for each subscription
  - Tagged with `[query-diag:ID]` for easy filtering

## Phase 2: Analysis (next)
- [ ] Review console output in browser to identify which queries are heaviest
- [ ] Quantify overlap between #8 (root descendants) and #11 (windowed node data)
- [ ] Determine if lazy-loading descendants (#c query) is feasible

## Phase 3: Optimization (based on findings)
- [ ] Skip redundant `#k` queries in TreeView when #8 already loaded descendants
- [ ] Consider lazy-loading descendants only for expanded branches
- [ ] Consider caching strategy for already-loaded relations
