# Agentic Workflow Roadmap

## Plan
- [x] Update `architecture.md` with the current `~Log` home/log behavior discovered in the code
- [x] Create `agentic-workflow.md` describing the phased path to background agents, a CLI authoring agent, and a link-only `~Home`

## Verification
- [x] Review the new docs for consistency with current behavior in the codebase
- [x] Confirm the roadmap keeps new concepts minimal and reuses existing Knowstr primitives

## Review
- Added a current-state architecture note that `~Log` auto-prepends new standalone roots and currently acts as the effective home/log.
- Added `agentic-workflow.md` with a phased rollout centered on a link-only `~Home`, background agent proposals, and an invoked CLI authoring agent.
- Extended `agentic-workflow.md` with the constrained gardener model: short-lived detached forks, explicit limits on proposal-internal linking, and the future alias/merge requirement for stronger adoption.
- Refined the gardener model: multi-document edits are allowed, but links must never target documents inside the gardener workspace; review is driven through a `To Review` document instead of `Proposal: ...` roots.
- Added `~Users` to the roadmap as a minimal address book: one list, stable identity by `publicKey`, editable labels, and no separate agent schema.
- Updated the roadmap with detached fork semantics: proposal deltas should be computed from fork-vs-base, not fork-vs-live-source, so untouched forks do not accumulate drift.
- No automated tests run because this task only changed documentation.

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
