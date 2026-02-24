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

## DnD Tests: Use Existing Patterns

Working DnD tests use simple patterns:
```ts
fireEvent.dragStart(screen.getByText("Item C"));
fireEvent.drop(screen.getByLabelText("Root"));
```
- Dropping on Root moves item to position 0 (beginning of children)
- No need for `setDropIndentDepth` for simple moves
- `fireEvent.dragStart` + `fireEvent.drop` is sufficient (no dragEnter/dragOver needed)
