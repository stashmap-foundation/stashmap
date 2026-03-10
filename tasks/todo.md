# Remove `~users` System Root

## Plan
- [x] Remove the dedicated `users` system root and its menu entry
- [x] Keep semantic user-entry behavior based on `userPublicKey`
- [x] Rework tests to use ordinary documents instead of `~users`

## Verification
- [x] `npm test -- --runInBand src/components/UsersNavigation.test.tsx src/components/UsersEntries.test.tsx src/contacts.test.ts src/components/HomeNavigation.test.tsx src/SignIn.test.tsx`

## Review
- Removed the `users` system-root type and the `Users` menu entry from the split-pane menu.
- Stopped preloading/querying a `users` system root; only `~Log` remains reserved.
- Kept row-level follow/unfollow, rename persistence, and relevance/evidence suppression driven by `userPublicKey`.
- Reworked the focused tests so user entries now live in ordinary documents such as `Address Book` and `Agents`.
- Historical `~users` notes below are kept only as implementation history; the active model is ordinary documents plus `contacts`.

# Clear Cache On Logout

## Plan
- [x] Ensure logout clears IndexedDB-backed cache reliably
- [x] Close active DB handles before `deleteDatabase`
- [x] Add a focused IndexedDB regression test

## Verification
- [x] `npm test -- --runInBand src/indexedDB.test.ts src/SignIn.test.tsx src/components/UsersNavigation.test.tsx`

## Review
- `clearDatabase()` now closes tracked open IndexedDB handles before deleting the database, which prevents the current tab from blocking cache deletion during logout.
- `Data` also closes its DB handle on cleanup so open connections are not left hanging across unmount/reload.
- Added a focused test that opening the DB and then clearing it closes the active handle before deleting `stashmap`.

# User Row Gutter Marker

## Plan
- [x] Make `userPublicKey` rows visually distinct in the existing gutter system
- [x] Reuse the app's monospace single-character indicator language instead of adding icons or a new row layout
- [x] Show follow state through the marker color

## Verification
- [x] `npm test -- --runInBand src/components/UsersEntries.test.tsx src/components/UsersNavigation.test.tsx src/SignIn.test.tsx src/components/SuggestionDisplay.test.tsx`

## Review
- Added a gutter `@` marker for rows bound to a `userPublicKey`.
- Bound-but-unfollowed rows use a muted marker; followed rows use a green marker.
- Kept suggestion rows on their existing violet `@`, so the feature fits the current terminal/solarized indicator system instead of introducing a new layout.

# Hide Unfollowed Authors From Overlays

## Plan
- [x] Make suggestion/version/incoming/occurrence projection respect the current visible-author set
- [x] Keep cached events available for storage/query reuse without surfacing them after unfollow
- [x] Add a regression test for unfollow hiding cached suggestions

## Verification
- [x] `npm test -- --runInBand src/components/SuggestionDisplay.test.tsx src/components/TreeView.test.tsx src/components/UsersEntries.test.tsx src/components/UsersNavigation.test.tsx src/contacts.test.ts`

## Review
- Suggestions, versions, incoming refs, and occurrences now filter against the current visible authors instead of every author still present in `knowledgeDBs`.
- This fixes the unfollow case where cached events from a previously followed contact kept surfacing after unfollow or reload.
- Added a regression test that unfollowing Bob removes Bob's cached suggestion from Alice's tree without needing to clear storage.

# User Entry Follow Actions

## Plan
- [x] Persist a stable `userPublicKey` on user-entry rows
- [x] Use row-level follow/unfollow wherever a row has `userPublicKey`
- [x] Hide relevance/evidence controls on semantic user entries, not just in one special location
- [x] Add tests for row follow/unfollow, rename-then-reload, and user entries in ordinary documents

## Verification
- [x] `npm test -- --runInBand src/components/UsersNavigation.test.tsx src/components/UsersEntries.test.tsx src/contacts.test.ts src/components/HomeNavigation.test.tsx src/SignIn.test.tsx`

## Review
- Added `userPublicKey` to persisted relations so user-entry rows keep a stable pubkey binding even when their visible label changes.
- Stored and restored that binding through markdown attrs, which makes rename-follow-reload work instead of tying follow state to the row text.
- Generalized the binding logic so rows created or edited anywhere in the graph can become user entries when their text is an `npub`, `nprofile`, or raw public key.
- Changed `RightMenu` to use `userPublicKey` as the semantic trigger for follow/unfollow and relevance/evidence suppression instead of checking a special root.
- Added focused tests for user-entry rows in ordinary documents, including rename-and-reload persistence.

# Remove Legacy `/follow` Flow

## Plan
- [x] Remove the old follow modal/page component
- [x] Remove the invite-link menu action that depended on `/follow`
- [x] Redirect stale `/follow` routes back to the dashboard
- [x] Replace follow-route coverage with dashboard/menu coverage

## Verification
- [x] `npm test -- --runInBand src/components/UsersNavigation.test.tsx src/components/UsersEntries.test.tsx src/contacts.test.ts src/components/HomeNavigation.test.tsx src/SignIn.test.tsx`

## Review
- Deleted the old `Follow` component and its dedicated test file.
- Removed the remaining invite-link menu item so the app no longer points users at the deleted route.
- Changed `/follow` to a simple redirect back to `/`, which keeps stale links from landing on a dead screen.
- Added coverage that the menu no longer exposes invite/follow entry points and that `/follow?...` no longer renders follow controls.

# Historical: ~users Foundation

## Plan
- [x] Add a `users` system root alongside the existing `log` system root
- [x] Add a main-menu entry that creates or opens `~users`
- [x] Preserve contact metadata (`userName`, `mainRelay`) when reading contact-list events
- [x] Ensure system roots are not automatically added into `~Log`
- [x] Add focused tests for `~users` navigation and contact metadata preservation

## Verification
- [x] `npm test -- --runInBand src/components/UsersNavigation.test.tsx`
- [x] `npm test -- --runInBand src/components/Follow.test.tsx`
- [x] `npm test -- --runInBand src/contacts.test.ts`
- [x] `npm test -- --runInBand src/components/HomeNavigation.test.tsx`
- [x] `npm test -- --runInBand src/SignIn.test.tsx`

## Review
- Added `users` as a real `RootSystemRole` and introduced `planEnsureSystemRoot(...)` so UI actions can lazily create system roots.
- Replaced the menu’s `Follow User` entry with `Users`, which creates or opens `~users` and navigates the pane there.
- Preserved `userName` and `mainRelay` when parsing contact-list events so future `~users` labels are not lost on reload.
- Changed root auto-log behavior so only ordinary roots go into `~Log`; system roots such as `~users` do not.
- Added focused tests for `~users` navigation, metadata preservation, and adjacent regressions.

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
- Rewrote `knowstr-cli-v1.md` as a write-only CLI centered on markdown subtree insertion plus structured operations for refs, `~Home`, and `contacts`.
- Updated `agentic-workflow.md` so the first external agent reads from synced markdown and writes through the small CLI, and adjusted the phase order accordingly.
- Updated `architecture.md` and `tasks/lessons.md` to capture the sync-first direction and the markdown-for-content / JSON-for-control split.
- Clarified that agent read scope should be inherited locally from the user's perspective, not implemented by making each agent publish mirrored follow lists.
- Clarified that `sync pull` is a snapshot command in V1; continuous refresh belongs in a later separate `sync watch` mode.
- Clarified that ordinary address-book docs plus `contacts` are the right people-management model, with follow/unfollow on user entries and no reserved root.
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
- Updated the roadmap so address books are ordinary documents and `contacts` is the only global people list the system needs.
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
