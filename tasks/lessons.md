# Lessons Learned

## Close active IndexedDB handles before clearing cache on logout

**Date**: 2026-03-10
**Context**: Logout already called `clearDatabase()`, but stale cached graph data could still survive because the app itself still held an open IndexedDB connection.

**Mistake**: Deleting an IndexedDB database while the current tab still has it open can be blocked, which makes logout look like it cleared cache when it did not.

**Rule**: For logout/cache clearing:
1. Close tracked IndexedDB connections first
2. Then clear the database
3. Treat cache clearing as part of logout correctness, not as optional cleanup

## Projection must respect current visible authors, not all cached authors

**Date**: 2026-03-10
**Context**: After unfollowing a contact, their suggestions still appeared, even after reload.

**Mistake**: Query scope had changed, but projection code still scanned all authors present in `knowledgeDBs`. Because cached events survive unfollow and reload, old authors kept leaking into suggestions and related overlays.

**Rule**: For overlays such as suggestions, versions, incoming refs, and occurrences:
1. Filter by the current visible-author set
2. Do not treat cached data as implicitly visible
3. Use `contacts`, project members, and any explicitly viewed author as the visibility boundary

## Remove obsolete route affordances when semantics move into the graph

**Date**: 2026-03-10
**Context**: After moving people-management semantics onto `userPublicKey` rows, the app still had a dedicated `/follow` page and invite-link share action.

**Mistake**: That left a parallel UX alive after the real workflow had moved into ordinary graph content. Keeping dead route affordances around makes the product model harder to understand.

**Rule**: When row-level graph semantics replace an old screen:
1. Remove the obsolete menu/share entry points
2. Delete the old page if it is no longer the intended workflow
3. Redirect stale URLs to a safe default instead of leaving a dead route

## Address books should stay ordinary documents

**Date**: 2026-03-10
**Context**: After trying a dedicated `~users` root, the cleaner model turned out to be row-level `userPublicKey` plus ordinary user-organized documents.

**Mistake**: Treating address books as a reserved root added a product concept that the app no longer needed once user-entry behavior worked anywhere.

**Rule**: For people/agent management:
1. Keep `contacts` as the global follow-state backend
2. Keep address-book organization in ordinary documents
3. Use `userPublicKey` as the semantic trigger for follow/unfollow and related row behavior

## Remove `~users` once `userPublicKey` is enough

**Date**: 2026-03-10
**Context**: After generalizing user-entry behavior, the app still had a dedicated `~users` system root and menu entry.

**Mistake**: That left a product concept in place after its semantic job had already moved to `userPublicKey`. Once user entries can live anywhere, the reserved root adds opinionated structure without providing necessary behavior.

**Rule**: When a row-level semantic field is sufficient:
1. Prefer ordinary documents over a reserved root
2. Keep only the minimal reserved roots the system truly needs
3. Let menu flows disappear if they only existed to support the removed reserved root

## Historical: Use lowercase `~users`

**Date**: 2026-03-10
**Context**: While discussing and documenting the address-book root, I kept using a mixed-case spelling for it.

**Mistake**: The user explicitly wants the reserved root written as `~users`, and mixing the casing across docs, tests, and code makes the feature feel less intentional than the other reserved names.

**Rule**: For this address-book feature:
1. Write the reserved root as `~users`
2. Keep constants, tests, and docs aligned to the same casing
3. Treat `Users` as menu text if needed, but keep the root/node text lowercase

## Historical: Use `user entry` or `user row`, not `card`

**Date**: 2026-03-10
**Context**: While describing the `~users` feature, I used the word "card" for the per-user document/row.

**Mistake**: "Card" is not existing Knowstr vocabulary and suggests a special UI component that the product does not need. The user-facing concept here is just a normal user entry inside `~users`.

**Rule**: In `~users` planning and implementation:
1. Use `user entry` or `user row` as the term
2. Do not introduce `card` as a product concept
3. Keep `~users` aligned with normal Knowstr document/list language

## Historical: Make `~users` the primary follow UX immediately

**Date**: 2026-03-10
**Context**: While sketching the `~users` address-book feature, I initially treated the current follow modal as something to keep around as a fallback entry point.

**Mistake**: That preserves a split UX for the same task. If `~users` is the real place for people and agent management, keeping the old follow flow as a parallel management surface just prolongs bad UX and weakens the mental model.

**Rule**: For the `~users` rollout:
1. Put follow/unfollow actions on the user entry
2. Make `~users` the primary place to add and manage people/agents
3. Remove the old `/follow` modal/menu flow instead of keeping it as the main surface
4. Keep contacts as backend follow state, but make `~users` the user-facing workflow

## Historical: Make `userPublicKey` the semantic trigger, not the `~users` root

**Date**: 2026-03-10
**Context**: After the first `~users` implementation, follow/unfollow behavior still depended on the row living directly under the `~users` root.

**Mistake**: That made `~users` too special. The cleaner model is that `~users` is just the default address-book location, while any row with a stable `userPublicKey` should behave like a user entry anywhere in the graph.

**Rule**: For user-entry behavior:
1. Use `userPublicKey` as the actual semantic trigger
2. Let `~users` stay the default place the menu opens, not the only place user entries work
3. Hide relevance/evidence and show follow/unfollow based on `userPublicKey`, not on root location

## Keep `sync pull` snapshot-based; add live refresh separately

**Date**: 2026-03-10
**Context**: While refining the sync-first agent model, I was still describing sync in a way that could blur one-shot snapshot export and continuous refresh.

**Mistake**: That makes the first version harder to reason about and suggests agents may need to repull after every write. The better split is to keep `sync pull` as an explicit snapshot and only add a separate `watch` mode later if freshness actually becomes a problem.

**Rule**: For the first agent sync model:
1. `sync pull` means one-shot snapshot export
2. Agents pull at task start, not automatically after every write
3. Write commands should return enough IDs/results that an immediate repull is often unnecessary
4. If continuous refresh is needed later, add a separate `sync watch` or daemon mode

## Separate public follows from local agent read scope

**Date**: 2026-03-09
**Context**: While discussing multi-agent workflows, I treated "what an agent can read" as if it should be solved by making each agent follow the same authors as the user.

**Mistake**: In Knowstr today, follows are both a social/public concept and a query boundary. Reusing public follow lists as the main agent read-scope mechanism would force agents to publish mirrored contact lists just to get context. That is the wrong layer.

**Rule**: For agent workflows:
1. Keep follow/contact events as public social state
2. Model agent read scope as a local sync/query decision
3. Let local agents inherit the user's read universe instead of publishing their own copied follow graphs
4. Use options like `--as-user` or explicit include lists for local read scope when needed

## Prefer sync-first markdown workspaces for agent context

**Date**: 2026-03-09
**Context**: While designing the first external-agent interface, I initially specified a read-heavy CLI with commands like `search`, `resolve`, and `subtree`.

**Mistake**: That made the first interface more complex than necessary and underused the fact that Claude Code and Codex already work very well with local markdown files and shell search tools. The better first step is a synced markdown workspace for reading and a small write CLI for mutations.

**Rule**: When designing external agent tooling for Knowstr:
1. Prefer a sync/export tool as the first read surface
2. Let agents read markdown files and use `rg` for discovery
3. Keep JSON for command planning and results, not for primary content reading
4. Postpone rich read/search CLI commands unless the synced workspace proves insufficient

## Prefer crefs or relation IDs for writes, not plain paths

**Date**: 2026-03-09
**Context**: In the first CLI spec, I used path-like strings such as `Projects/Knowstr` directly in write examples like `create-ref`.

**Mistake**: Paths are convenient for humans but ambiguous for writes. Stable write targets should use concrete relation identities, ideally cref or relation ID. Paths are acceptable only as a discovery layer that resolves to one unique target first.

**Rule**: When designing external graph tools:
1. Use paths for search and resolve
2. Use cref or relation ID as the preferred write selector
3. If a write command accepts a path, require explicit resolution to one unique target
4. Never let write commands guess between multiple path matches

## Distinguish fork-vs-base from fork-vs-live-source

**Date**: 2026-03-09
**Context**: While discussing gardener proposals, I initially treated fork drift as something that might be acceptable after the first local edit.

**Mistake**: The user clarified that even after local edits, a fork should not keep drifting against the live upstream version. Proposal intent should come from the fork's changes since it was created, not from unrelated upstream edits.

**Rule**: When discussing fork/proposal semantics:
1. Treat forks as detached workspaces
2. Compute proposal deltas from fork current versus fork base
3. Treat upstream changes as a separate status, not as proposal diff inflation
4. Do not describe live-source comparison as the desired behavior for forks

## Distinguish multi-document editing from proposal-internal linking

**Date**: 2026-03-09
**Context**: While refining the gardener workflow, I treated "editing multiple documents" and "linking between forked proposal copies" as the same restriction.

**Mistake**: The real boundary is narrower. A gardener may edit multiple documents, but it should not create links to documents inside its own workspace. Proposal-internal links are the part that creates the hard adoption/remapping problem.

**Rule**: When discussing the gardener model:
1. Allow multi-document editing if needed
2. Forbid links from one forked gardener document to another forked gardener document
3. Prefer links from gardener documents to stable external targets only
4. Use a `To Review` document for navigation instead of building a self-contained proposal graph

## Do not assume agent features are integrated into the web app

**Date**: 2026-03-09
**Context**: While discussing the agentic workflow roadmap, I described the CLI authoring agent as if the web app would pass it current UI state such as the focused node and nearby tree context.

**Mistake**: The intended model is that agents run externally, for example in a CLI or companion app. That means their context must come from graph queries and explicit user-provided targets, not from assumed in-app integration.

**Rule**: When discussing agents in this project:
1. Do not assume they are embedded in the web UI unless the user says so
2. Separate external graph-query capabilities from in-app UI state
3. For external agents, describe inputs in terms of paths, URLs, relation IDs, search, and graph slices
4. Only talk about focused panes or selected nodes if the user explicitly wants app-integrated agent behavior

## NEVER delete existing tests — move and adapt them

**Date**: 2026-02-23
**Context**: When changing the X button from "remove from list" (disconnect) to "toggle not_relevant", I attempted to delete the 5 "Remove from list" tests and replace them with 2 new X toggle tests.

**Mistake**: The tests were testing deletion behavior (disconnect from parent, orphan cleanup). That behavior still exists — it just moved from the X button to the Delete/Backspace key. Deleting those tests would have removed valuable coverage.

**Rule**: When behavior moves from one UI element to another:
1. Move the tests to a new file matching the new UI element
2. Adapt them to use the new interaction (e.g., keyboard shortcut instead of button click)
3. Keep the same assertions — the underlying behavior hasn't changed
4. THEN write new tests for the changed UI element's new behavior

**General principle**: Tests are coverage, not UI-element-specific. If a test exercises important behavior, that coverage must be preserved even when the triggering mechanism changes.

## Event metadata needs matching query loading

**Date**: 2026-02-23
**Context**: Adding context tags to tombstone delete events so deleted crefs can show full paths.

**Rule**: When adding metadata to Nostr events (like tombstone context tags), the corresponding node IDs must also be added to `TreeViewNodeLoader` queries — otherwise labels show "Loading..." instead of resolved text. The query system and the rendering system must stay in sync.

## Tests for event-persisted features MUST include cleanup/reload

**Date**: 2026-02-23
**Context**: Testing tombstone context persistence.

**Rule**: Tests for features that persist data via Nostr events (tombstones, crefs, etc.) MUST include a `cleanup()` + re-render phase to verify the event round-trip. Data in local state doesn't prove events are serialized correctly — only a full reload proves that.

## REUSE existing functions — never duplicate logic

**Date**: 2026-02-24
**Context**: Writing `getIncomingCrefsForNode`, I duplicated deduplication/sorting logic instead of reusing `deduplicateRefsByContext` which already handles effectiveAuthor-first + most-recent sorting.

**Mistake**: Built inline dedup (groupBy + sortBy + first) and inline outgoing-cref-set-building instead of calling existing helpers. This has happened multiple times.

**Rule**: Before writing ANY logic:
1. Search the codebase for existing functions that do the same thing
2. If a function exists, call it — even if the types need minor adapting
3. If you need a subset of existing logic, extract a helper and share it
4. CLAUDE.md says "Reuse code!" — this is a hard requirement, not a suggestion
5. Common patterns to watch for: deduplication, sorting, ID parsing, context key building, covered-context checks

## Multi-user CLI: inbox apply should normalize raw inbox edits instead of rejecting id-less additions

**Date**: 2026-04-13
**Context**: The user copied a saved document into `inbox/`, manually added `Germany` and `Berlin` without ids, and `knowstr apply` logged the file as invalid.

**Mistake**: Raw inbox is a staging area humans may edit directly. Rejecting id-less additions makes the MVP unusable in the obvious manual workflow.

**Rule**: For `knowstr apply`:
1. Preserve existing ids from raw inbox docs
2. Auto-assign ids to newly added inbox nodes during apply normalization
3. Only reject inbox files for real structural problems, not for missing ids on new additions

## Multi-user CLI: avoid `~` in actual filenames

**Date**: 2026-04-13
**Context**: Used `~log.md` as the on-disk filename for the CLI log.

**Mistake**: `~` in actual filenames is awkward in shells and needs escaping. The user wants the readable concept without awkward paths.

**Rule**: For CLI workspace artifacts:
1. Prefer plain filenames such as `knowstr_log.md`
2. Keep `~Log` as document text if useful, but not as the literal filename by default

## Multi-user CLI discussion: be concise and do not treat root UUID as special

**Date**: 2026-04-13
**Context**: While discussing the CLI snapshot/apply model, I gave overly long answers and introduced `rootUuid` as if it had special semantic status.

**Mistake**: The user wants a dialogue, not long essays. For identity, the meaningful cross-user key is effectively `(author, uuid)` on the transport/baseline side, not a privileged root UUID. Also, delete inference is acceptable once a baseline exists because inbox/raw is expected to contain complete documents, not partial exports.

**Rule**: In multi-user CLI discussions:
1. Keep answers short and interactive
2. Do not elevate `rootUuid` to a special merge concept unless strictly necessary
3. Assume deletes can be inferred from absence when a baseline exists and raw inputs are complete
4. Answer the concrete folder/UX question directly before adding theory

## Multi-user CLI design: treat node UUIDs as the only semantic merge key

**Date**: 2026-04-13
**Context**: While sketching first multi-user sharing UX, I over-emphasized `knowstr_doc_id` and drifted toward reintroducing long IDs for distinguishing local vs inbox state.

**Mistake**: For cooperative sharing, the user's intended identity model is preserved node UUIDs. Inbox-vs-graph should be represented by storage/state, not by minting a second identity namespace. `knowstr_doc_id` may be useful as packaging/grouping, but it is not the core merge key.

**Rule**: For multi-user CLI design:
1. Use short node UUIDs as the semantic identity
2. Do not reintroduce long IDs just to distinguish inbox from graph
3. Represent `graph` vs `inbox/raw` vs `inbox` by storage location and explicit state
4. Treat document/thread IDs as optional grouping metadata, not the primary merge key

## Project lessons go in tasks/lessons.md, NOT MEMORY.md

**Date**: 2026-02-23
**Context**: Put tombstone lessons into MEMORY.md instead of tasks/lessons.md.

**Mistake**: CLAUDE.md explicitly says "After ANY correction from the user: update `tasks/lessons.md`". MEMORY.md is for codebase architecture notes and code style reminders, not correction-driven lessons.

**Rule**: Always put lessons from corrections in `tasks/lessons.md`. MEMORY.md is only for persistent architecture/style notes that help across sessions.

## Test Writing: Build Incrementally

**Mistake**: Wrote an entire DnD test in one shot with assumed typing sequence, then spent hours debugging why the tree structure was wrong and the drop target was wrong.

**Rule**: Always build tests step by step. After EVERY statement, add `await expectTree(...)` to verify the current state. Only proceed to the next step once the current one produces the expected tree. Never write a full test and then debug it.

## Typing Sequences: How Tree Structure Works

**Mistake**: Assumed `Apple{Enter}Basket` creates Apple and Basket as siblings. It doesn't — `{Enter}` from an expanded node creates a child inside it.

**Rules**:
- `{Enter}` creates a new node AFTER the current one at the same depth — but if the current node has expanded children, the new node appears inside it
- To add a sibling of a node that has children, click the PARENT's editor and press `{Enter}`
- `{Tab}` indents (makes child), works on new empty nodes
- When in doubt: type a small sequence, check with `expectTree`, then continue

## DOM Order with Duplicate Names

**Mistake**: Assumed `getAllByRole("treeitem", { name: "Apple" })[1]` would return the "inner" Apple. Got confused about which index maps to which element.

**Rule**: `getAllBy*` returns elements in DOM order (top to bottom in the rendered tree). With a tree like:
```
Root
  Basket
    Apple    ← [0] (rendered first in Virtuoso)
  Apple      ← [1] (rendered second)
```
The Apple under Basket is `[0]` because it appears earlier in the visual tree.

## NEVER check if tests pass on master

**Date**: 2026-02-28
**Context**: Debugging a failing C2 test. Started checking out master to see if the test passes there.

**Mistake**: Tests on master always pass. The whole point is that THIS branch broke them. Checking out master wastes time and risks losing state (stash, working directory).

**Rule**: NEVER checkout master or another branch to check if a test passes there. It always does. Focus on understanding what changed on the current branch that broke the test.

## DnD Tests: Use Existing Patterns

Working DnD tests use simple patterns:
```ts
fireEvent.dragStart(screen.getByText("Item C"));
fireEvent.drop(screen.getByLabelText("Root"));
```
- Dropping on Root moves item to position 0 (beginning of children)
- No need for `setDropIndentDepth` for simple moves
- `fireEvent.dragStart` + `fireEvent.drop` is sufficient (no dragEnter/dragOver needed)

## Cref vs Regular Node Suggestions: Don't Use `isConcreteRefId` Alone

**Date**: 2026-02-27
**Context**: When another user has a cref in their relation, the suggestion should add the cref link (planAddToParent), not deep copy the tree (planDeepCopyNode). Needed to distinguish cref pass-throughs from regular nodes wrapped as crefs.

**Mistake**: First attempted `isConcreteRefId(virtualItem.nodeID)` check in batchOperations.ts. This broke existing tests because `getSuggestionsForNode` wraps ALL suggestions with headRefs as cref IDs (via `createConcreteRefId`), even for regular nodes.

**Rule**: In `getSuggestionsForNode`, both regular nodes AND crefs end up as cref IDs in the suggestions list — but for different reasons:
1. Regular node candidates: wrapped via `createConcreteRefId(first.relationID)` on line 149
2. Cref candidates: `shortID()` preserves the cref prefix, pushed as-is on line 151

To distinguish them, propagate the information from the source:
- `getSuggestionsForNode` → tracks `crefSuggestionIDs` (candidates where `isConcreteRefId(candidateID)` was already true)
- `treeTraversal.ts` → sets `isCref: true` on virtual items from that set
- `batchOperations.ts` → checks `virtualItem.isCref` to choose `planAddToParent` vs `planDeepCopyNode`

**General principle**: When all items look the same structurally (all cref IDs), the distinction must be propagated from where it originates, not inferred at the consumption site.

## Markdown serializer indent must match parent marker width

**Date**: 2026-04-07
**Context**: Adding heading/ordered-list preservation to the CLI save pipeline. Nested bullets under ordered list items were silently corrupted on the second save — nested content escaped the list and `2. second` became `5. second`.

**Mistake**: Hardcoded a uniform 2-space indent for all nested content in the serializer. Worked for bullet trees by accident (bullet marker `- ` has content column 2), but broke for ordered lists where `1. ` has content column 3.

**Root cause (CommonMark §5.2)**: A list item's continuation content must be indented to the content column of the first line, which equals marker width W + N spaces after marker. For `- ` that's 2, for `1. ` it's 3, for `10. ` it's 4. Less than that and the line "escapes" the list; the parser then starts a new list with `<ol start="N">`, so the next time we serialize we get wrong numbers.

**Rule**: Any markdown serializer that emits nested lists must compute child indent from the parent's content column, never from a fixed nesting depth:
1. Pass `indent: string` (not `depth: number`) through recursion
2. Compute `childIndent = parentIndent + " ".repeat(W + N)` based on parent's marker width
3. For bullets: `parentIndent + "  "` (2 chars). For ordered: `parentIndent + " ".repeat(String(number).length + 2)` (handles single and multi-digit)
4. Test roundtrip stability by calling the save path twice and asserting `changed_paths === []` on the second run — cosmetic tests aren't enough, byte-level idempotency is what catches this class of bug

## Creating Crefs in Tests: Use Alt-Drag, Not Typing

**Date**: 2026-02-27
**Context**: Needed a test with a cref suggestion. Tried creating nodes by typing, which only creates ordinary nodes.

**Rule**: To create a cref in a test, use the alt-drag pattern:
```ts
await userEvent.keyboard("{Alt>}");
fireEvent.dragStart(sourceElement);
fireEvent.dragOver(targetElement, { altKey: true });
fireEvent.drop(targetElement, { altKey: true });
await userEvent.keyboard("{/Alt}");
```
Typing `Source{Enter}{Tab}Child` creates ordinary nodes. Only alt-drag creates crefs.
