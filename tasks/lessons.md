# Lessons Learned

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
