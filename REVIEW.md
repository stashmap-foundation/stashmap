# Review: phase-3.4b-rewrite

Reviewed 2026-08-05. State under review: worktree `knowstr-phase-3.4b-rewrite` on top of 3.4a (`e7c9a39`), since committed as `536b65e`.

---

Both repos are clean — the only untracked file is your own `bug.md` (the worktree gained it plus four new anchor-drag tests *while* I was reviewing, so this review covers the state as of today; the very newest tests follow the same patterns and don't change the verdict).

Here is the full review. Method: I read the route in `implementation.md`, the lab's `RULES.md`, and the new core myself; ran the full gate (`tsc` clean, 74 suites / 921 tests green); and fanned out four reviewers — one of which built a scratch harness in `/tmp` and **ran all 120 lab fixtures through the new `composeNote` empirically**. Nothing in any repo was touched.

## Verdict

The branch built the new engine but never removed the old one. `composition.ts` is a genuinely decent twin — **108 of 120 lab fixtures pass** against it — but the surrounding diff is an *overlay*, not a rewrite: ~2,800 lines added, ~130 deleted, and the route's step 4 ("delete the old machinery") is simply not done. Every touch surface now contains two write paths selected by runtime guards, which is precisely the disease the 2026-08-04 route note diagnosed as "the source of the string of regressions" — except now there are more parallel paths than before.

## The worst mistake

**The corpus gate is a Potemkin gate, and it hid a broken core.** The route's step 1 gate is "reproduces `expected.tree` for every transferred corpus fixture." Exactly **one** of 120 fixtures was transferred — `01-empty-overlay`, the trivial identity projection — so the gate is green while proving nothing. When the 120 lab fixtures are actually run against `composeNote`, **12 fail**, and 11 of those 12 sit in fixture families that were never transferred. Whole rule families are missing from the core:

- **Absorption (rule 17) does not exist at all** — no absorbed-set anywhere; fixtures 89, 90, 93, 95 fail (the reader's row renders twice).
- **Merge rewordings follow only the first struck link** — `targetOf` at `composition.ts:113` discards the rest; fixtures 90, 94 fail.
- **Evidence edge-broken lapse (rule 8) is missing** — no `+`/`-` direct-child check; fixture 111 fails.
- **The pending mechanism (unanchored placement follows its source occurrence) is missing** — fixture 39 fails.
- **Consumption runs after anchor resolution instead of before** — fixture 38 fails; **dismissed rows kill sibling anchors** ("anchors resolve before suppression" violated) — fixture 18 fails; **no tail region** — fixture 42 fails; **consumption leaks sideways into sibling placements** — fixtures 74 and 85 fail (85 collapses 7 expected rows to 3).

Every one of these would have been caught on day one by doing the route's own first step honestly: transfer the corpus, then build the core against it. The lab fixtures are sitting right there in `overlay-composition-lab/fixtures/` in a shape the harness already supports (it even handles `sources/` subdirs — dead weight for one fixture).

## Why the architecture is bad

**1. Two doors everywhere, forever disagreeing.** `Row.materialize` still exists (`types.ts:213`) — the mandate says Row *loses* it; instead Row *grew* an optional `composed?` (`types.ts:221`), the tell that composition was bolted on rather than swapped in. Concretely, in each touch surface the old and new paths sit side by side behind a guard:
- `useNodeItemContext.ts:96-133` — gesture door vs `row.materialize` door in the same `updateMetadata`;
- `batchOperations.ts:57-105` — same fork, with the gesture-construction block copy-pasted verbatim between the two files;
- `dnd.tsx:334-349` — a 15-line `composedMove` boolean decides which door handles a drop, re-deriving embed-ness at the call site (routing logic the door was supposed to own); the legacy body below (`dnd.tsx:364-601`) keeps three hand-rolled move/reorder/add recipes;
- `Node.tsx:629-670` — reword gesture vs old materialize-take in one save handler; and **Tab-indent/outdent never touch the door at all** (`Node.tsx:754`, `batchOperations.ts:268-429`) even though indenting is a move.

**2. "Display reads the composed tree" became "display calls composeNote as an oracle."** There is no single composed tree that the screen reads. `composedRowForViewPath` (`treeTraversal.ts:219-247`) runs a *whole-note composition inside per-row path resolution*, and `resolveRowForPath` recurses to the parent which recomposes again — O(depth) full compositions per resolved path, plus a double-composition at the root (`treeTraversal.ts:312-313, 393`). Meanwhile `getChildrenForRegularNode` (`treeTraversal.ts:1121-1150`) still builds the full raw-graph child rows every time and throws them away when `composed` is set. The raw path remains live and authoritative for every non-composed row, so display still re-derives composition facts from the raw graph (`createRow`'s `projected`/`standsFor` at `treeTraversal.ts:135-146`, `Node.tsx:575-596` re-classifying links and re-implementing `effectiveText`).

**3. Fold state is patched, not keyed — with a bug.** The mandate: open/closed keys on the composed row's stable id, "by construction, not by patching." The implementation keeps full view-path string keys and migrates them per gesture via `copyViewsWithNewPrefix`. The evidence-mark case gets the migration wrong: `planner.tsx:385-387` writes the touched row's state under the *old* parent segment while the row now renders under the new parent — fold state of an expanded subtree is lost on evidence marks. `move()` handles the same case correctly at `planner.tsx:426`, which proves the two paths have already diverged. And the mandated test — "mark a great-grandchild and assert nothing folds" — does not exist; the suite expands everything with Cmd+Down before asserting, which masks folding.

**4. The pure core isn't pure and the door is split in half.** The `Gesture` type in `src/core/composition.ts:57-85` carries view paths with a *pane index* — folding, panes, and React were supposed to be unknown to the core. The door (`applyGesture`, `planner.tsx:450`) writes view state in the same function that produces the file edit, so it can't be exercised without views. And the `after=`/`front=` contract is now interpreted on the read side in `composition.ts` but re-encoded on the write side in `planner.tsx:219-276` (`positionRows`) — two ends of one contract in unrelated files.

## App-level bugs the green suite doesn't see

1. **Real drags land at the front.** The door derives position solely from `after`; `dropIndex` is unused on the composed path, and `resolveDropByDepth` (`dnd.tsx:270-292`) never sets `anchorRow` — and that's the path taken on every real mouse drag, because hovering initializes `targetDepth` (`DroppableContainer.tsx:255-271`). So in the running app, nearly every composed-routed drop inserts at position 0 regardless of where the user dropped. Tests pass because synthetic `dragStart`/`drop` skip hover. This is exactly the "manual gesture is part of acceptance" trap.
2. **Judging a drifted placement rewrites it into a bogus rewording.** Callers pass the frozen label spans as `gesture.spans`; `isRewording` (`planner.tsx:305-311`) compares them to the *live* text, so any drift makes a plain `!` keypress convert the placement — the stale frozen label becomes the user's "spoken words." Dismiss has the same path.
3. **Evidence on an already-written line skips the parent-line shape** — `judge`'s `existing` branch just stamps `argument` on the flat line (`planner.tsx:320-336`); marking `+` on a previously relevance-materialized row yields an evidence claim with no parent context.
4. **Composed foreign drags skip `planRecordForeignSource`** (`dnd.tsx:350-362` bypasses `:563-566`) — `knowstr_sources` never gets the document id, so the embed won't resolve after a future fetch. That's an explicit 3.4-series requirement.
5. **Rewording conversion discards the frozen label** — the struck bond gets the *live* text (`rewordingSpans` fallback), but the law says "the user's words plus the struck label recording the source text at that moment."
6. **Latent core divergences from compose.py** with no fixture coverage yet: cross-family marker inheritance (TS renders `{+!}` where Python renders `{!}`; an outer `(+)` fails to restore an inner `(x)`), `moveAnchorsOnce` will relocate *base-authored* rows (Python moves reader rows only), no transitive hiding inside dismissed subtrees, and an invented `siblingCandidates`/`baseCandidates` preference cascade (`composition.ts:326-338`) that replaces Python's exact-id preference and directly causes the fixture-38 failure.

## Coding-standard violations

Clean where it's easiest to be dirty, dirty where it matters. Zero comments, zero new casts or non-null assertions, only the three permitted types — genuinely good. But:

- **Parallel logic (the cardinal ban):** the two-door forks above; the judge/dismiss dispatch copy-pasted between `useNodeItemContext.ts:96-125` and `batchOperations.ts:57-78`; inside the core, `prunePlacementTargets` vs `pruneExternalTargets` (`composition.ts:683-704` vs `:735-751`, byte-identical filter predicates) and the ComposedRow literal assembled twice (`:455-493` vs `:610-637`) — the exact "two near-duplicate functions" shape the route blamed for the old regressions, reborn inside the replacement; the `existing` lookup block repeated 3× in `planner.tsx`; `getVisibleParentRow` — on the mandate's deletion list — *extended* instead (`dnd.tsx:113-125`).
- **Dead code:** the `place` gesture has no producer anywhere (`composition.ts:79`, handler `planner.tsx:467-479`); `CompositionResult.claims` and `diagnostics` are computed on every compose and consumed by nothing; `insertAtWrittenParent`'s non-front branches are unreachable.
- **Banned patterns:** `treeSignature` + signature-set convergence (`composition.ts:368-385`) is memo-style correctness patching where compose.py uses a plain bounded loop; `prefix: number[] = []` default param; `writtenParent`/`sourceParent` optional chains with defensive `??` bleeding into `planner.tsx:344`.
- **Contract gaps:** claim records use the placement row id as `context` where the reference uses the target id, lack kind/text, and are collected from the composed tree instead of the reader's file — which will silently drop absorbed rows' claims once absorption lands, the exact opposite of RULES.md 222-224.

The tests themselves are the branch's best work — pattern-conformant, real gestures, and they do assert touched-row-only writes, evidence shape, rename→rewording, and dedup-at-topmost. Two soft spots: partial-regex file assertions instead of the whole-file `expectMarkdown` (an extra spurious written line would pass), and a ~5-line render/expand boilerplate inlined ~24 times next to the helper that already wraps it. One silently-accepted regression: nine "Navigate to X" accessible labels became bare "X" when those rows moved into the editor path — the tests were edited to match rather than the label carried over.

## What I would do differently

1. **Transfer the corpus first — all 120 fixtures — and make `composeNote` green before touching a single UI file.** That's the route's own step 1, honestly executed. The 12 failures fall out immediately, and the missing passes (absorption, merge-rewording, evidence edge, pending, tail, claimed-parent ordering) get built against oracles instead of intuition.
2. **Port compose.py's pass structure literally, one function per pass, same order.** No invented candidate cascades, no split prune twins, no signature-set fixpoint. Where the twin diverges today it is wrong in every empirically checked case.
3. **Compose once per note at the top, pass the tree down.** Display becomes a map over `ComposedRow` with zero graph lookups; delete the raw `childRowPairs` path for composed documents in the same change.
4. **Key fold state on the composed stable id and delete `copyViewsWithNewPrefix` patching entirely.** That removes the stale-key bug *class*, not just the evidence-case instance, and makes the "nothing folds" property true by construction — then write the mandated great-grandchild test.
5. **Port one gesture at a time, but each port deletes its legacy path in the same checkpoint.** No `row.composed ?` forks left behind. Indent/outdent route through the door as moves. The door takes ids, not view paths; view migration stays in the caller; `after`/`front` encoding lives next to its decoder in core.
6. **Make one drag test drive the real hover machinery** (`updateTargetDepth`/`setDropIndentLevel` before drop) — that single test catches the drop-at-front bug and enforces "manual gesture is part of acceptance" permanently.

## What is worth keeping

- **`composition.ts` as the seed of the twin** — 108/120 empirical passes, correct recognition, recursion, cycles, ballots, dismissal, and degradation flags, and a conforming `treeFromComposition`. It needs the six missing/divergent passes and internal dedup, not a restart.
- **The corpus harness** (`compositionCorpus.test.ts`) — sound shape, already handles multi-source fixtures; needs strictness (a fixture dir missing a file should fail, multi-top diffs should throw) and, above all, the other 119 fixtures.
- **The new integration tests, essentially all of them** — including the expectation changes, which audit as legitimate (the one readonly-embed test's behavior change is the mandated 3.4b typing semantics; only its stale "readonly" name and the lost "Navigate to" labels need fixing). They are exactly the acceptance suite the redo should run green against.
- **The `Gesture` vocabulary and the `applyGesture` door concept** — right idea, wrong purity and wrong completeness; salvage the design, fix the seams.

One more thing: your `bug.md` note about afters needing re-aiming when their anchor row is dragged is adjacent to the fixture-38/18/42 family above — the anchor/consumption ordering in the core is where that class of bug lives, and fixing the core against the transferred fixtures will likely resolve it more durably than patching the drag path.
