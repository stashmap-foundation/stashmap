# Sync-First Agent V1

## Plan
- [x] Write `knowstr-sync-v1.md` with a concrete markdown export format for agent reading
- [x] Narrow `knowstr-cli-v1.md` to a write-only CLI that assumes agents read from the synced workspace
- [x] Update `agentic-workflow.md` and `architecture.md` to make sync-first the preferred external-agent path

## Verification
- [x] Review the sync-first docs for consistency with the current graph model and the detached-fork roadmap
- [x] Confirm read context comes from markdown export and the CLI stays write-focused

## Review
- Added `knowstr-sync-v1.md` with a read-only export model: synced markdown workspace, frontmatter IDs, manifest, and agent workflows for Claude Code/Codex.
- Rewrote `knowstr-cli-v1.md` as a write-only CLI centered on markdown subtree insertion plus structured operations for refs, `~Home`, and `~Users`.
- Updated `agentic-workflow.md` so the first external agent reads from synced markdown and writes through the small CLI, and adjusted the phase order accordingly.
- Updated `architecture.md` and `tasks/lessons.md` to capture the sync-first direction and the markdown-for-content / JSON-for-control split.
- Clarified that agent read scope should be inherited locally from the user's perspective, not implemented by making each agent publish mirrored follow lists.
- Clarified that `sync pull` is a snapshot command in V1; continuous refresh belongs in a later separate `sync watch` mode.
- No automated tests run because this task only changed documentation.

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
