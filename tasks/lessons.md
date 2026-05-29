# Lessons Learned

## A plan must be executable, phased, and tied to concrete files/tests

**Date**: 2026-05-28
**Context**: User asked for a plan to finish the multi-root branch. I produced a generic checklist that named broad areas but did not sequence exact test-first slices, files, acceptance criteria, or verification commands. User correctly called out that it was not a real plan.

**Rule**:
1. A real plan has phases that can be executed one by one.
2. Each phase lists the failing tests to add first, the specific files/functions to change, and concrete acceptance criteria.
3. Avoid broad buckets like "fix links" unless they are broken down into exact code paths and expected behavior.
4. For urgent branch finalization, separate merge blockers from deferred product work.

## Verify active branch before planning or editing

**Date**: 2026-05-28
**Context**: During multi-root document finalization, I initially analyzed and wrote a plan while the worktree was on a branch without the feature diff.

**Rule**:
1. Run `git status --short --branch` before planning or editing.
2. Confirm `git diff --stat master...HEAD` contains the expected feature diff.
3. If the feature is on another local branch/ref, stop and ask before editing.
4. Ignore `/tmp` worktrees unless explicitly asked to use them.

## Link/ref fixes need a full direction-and-kind matrix

**Date**: 2026-05-28
**Context**: After Phase 4, user asked to cover all combinations of file links, graph links, incoming refs, outgoing refs, and bidirectional links from both sides. I had covered representative cases but not an explicit matrix.

**Rule**:
1. For link/ref work, enumerate link kind (file vs graph), location (child vs top-level vs non-first root), and direction (outgoing source view vs incoming target view).
2. Include bidirectional/mutual cases and verify both sides render without duplicate incoming rows.
3. Add regression tests before considering link behavior complete.

## Keep link indexes singular and ID-only

**Date**: 2026-05-28
**Context**: While fixing bidirectional link rendering, I tried adding a second incoming graph-link index. User pointed out the simplest safe model is one index containing IDs, then lookup current nodes when metadata is needed.

**Rule**:
1. Do not add parallel indexes for the same relationship unless there is a proven need.
2. Indexes should store IDs, not node objects.
3. Read mutable node metadata by looking up the indexed ID in the current graph data.
4. Prefer changing consumers to derive owner/context from the indexed link item ID over adding another index.

## Stop implementation immediately when the user asks to discuss a bug category

**Date**: 2026-05-29
**Context**: While diagnosing markdown file-drop behavior, I started adding an exploratory helper/test after the user asked to figure out what was going on before implementing. The user clarified we should talk about the bug category first.

**Rule**:
1. When the user asks to diagnose or discuss before implementation, do not edit production/test files beyond explicitly requested notes.
2. If exploratory edits were already made, revert them before continuing the discussion.
3. Separate diagnosis, desired semantics, and implementation plan in the response.

## Run full Jest without --runInBand unless explicitly needed

**Date**: 2026-05-29
**Context**: During multi-root branch verification, I ran `npm test -- --runInBand` for the full suite. User corrected that the suite is much faster without `--runInBand`.

**Rule**:
1. Use plain `npm test` for full-suite verification by default.
2. Only add `--runInBand` for narrow focused debugging or when a known test isolation issue requires it.
3. If using `--runInBand`, state why it is necessary.
