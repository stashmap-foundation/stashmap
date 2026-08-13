Review: phase-3.4b-rewrite at 02ba839

Verdict up front: this branch is half a rewrite wearing a whole rewrite's name. Since the 2026-08-05 REVIEW.md, the core was genuinely repaired — composition.tpass port of compose.py, all 120 lab fixtures are transferred byte-identical and pass through a strict harness, the drop-at-front bug and the Casa Mila duplicate
are fixed with honest tests that drive reals good and worth keeping. But the route'sstep 4 — delete the old machinery — never happened: the src diff is 9,945 insertions against 169 deletions, zero
files deleted. Row.materialize survives witsurface still forks at runtime between thegesture door and the legacy path, and the newest bugfix commit (3e871c1) widened a fork instead of removing one. The
result is not the old architecture or the nimultaneously, selected row-by-row by runtime guards.

Why the architecture is bad

The 2026-08-04 route note diagnosed the original disease precisely: whole-note rules rebuilt per level in near-duplicate functions, each gesture re-dtions. The branch built the cure (one purecompose, one door) and then installed it beside the disease instead of in place of it:                               
1. Every surface is a two-to-three-way runtime fork. useNodeItemContext.ts:97-124 and batchOperations.ts:86-123 each  branch row.composed → door, row.materializedata plan. Node.tsx:644-758 forksreword-gesture vs. materialize-take inside one save handler. dnd.tsx:335-351 gates on composedMove — a seven-clause   predicate over scopes, refs, and row kinds  above ~238 lines of legacy move/reorder/addrecipes below. Tab indent/outdent (Node.tsx:760-870 → batchOperations.ts:284-445) never touch the door at all, though indenting is a move. Which regime handles arow, per gesture, at runtime.
2. There are now three move implementations. The door's move()/positionRows/repairSourceDependents (~280 lines,       planner.tsx:236-631), the legacy dnd recipeMutations.planMoveNode. The route existed toget from two write paths to one; the branch got to three.                                                             3. Display half-reads the composed tree. Coote at the top (composedAt,treeTraversal.ts:223-242 — the 4ed17d3 fix is real), but getChildrenForRegularNode (treeTraversal.ts:1109-1156) still builds full raw-graph child rows and throwset; createRow derives projected/standsForfrom the raw graph and attachComposed then overwrites both; Node.tsx:589-610 re-classifies links and re-implements the effective-text choice at the edit layer authoritative for every non-composed row, so "display never reinterprets composition" is still false.
4. The pure core isn't pure and the door isries pane-indexed view paths intosrc/core/composition.ts:69-97 — and the path field on judge/dismiss/reword is never even read (dead payload through
the core type). move() writes view state inx:575, 605). The after=/front= contract isdecoded in core (composition.ts:247-405) but encoded in planner.tsx:236-351 — two ends of one wire contract in
unrelated files. And the app now has two ree contract: core's rowKind/rowTargets vs. the nodeSpans.ts predicates that planner.tsx:450 still uses — and they already disagree on struck non-embed links.
5. Fold state is three mechanisms, not one.per-gesture prefix migration viacopyViewsWithNewPrefix (still alive for moves, planner.tsx:205-234, and inside legacy planMoveNode), plus the new
resolveRowView stable-id fallback chain (ron top. The mandate said keyed byconstruction; this is keyed by construction and patched and migrated, with rows carrying two separate key spaces
(viewKey for selection, viewStateKey for fo

Why this matters beyond aesthetics: every fre must either be written twice or guardedinto one regime — which is exactly how the "string of regressions" happened the first time. 3e871c1 is the proof in miniature: fixing the duplicate-move bug mee predicate so more cases reach the door,leaving the legacy branch as a shrinking-but-live trap for whatever rows still fall through.

The worst mistake

Stopping at "the new engine works" and calling it a rewrite. The remediation after REVIEW.md fixed the core and added
~4,600 lines of tests — and then stopped exe begins. Worse, the last commits show theratchet reversing: 1da8d6e re-introduced invented composition structure (a readerScope/claimedParent preference
cascade, composition.ts:504-541, 851-858, rirst-wins Map — no lab counterpart, no labfixture justifying it) in the very spot where the previous invented cascade was just removed, and 3e871c1 widened a
fork. The branch is re-growing the disease erges as "the rewrite," the two-write-patharchitecture becomes the consolidated, tested, blessed state of the codebase.

Bugs and edge cases the green suite doesn't see

1. Evidence rebind destroys the reader's subtree. judge's existing-line rebind (planner.tsx:454-457) calls         planRemoveNodeItemById — which deletes the aPlanner.ts:86-90) — then mints a freshplacement. Children the reader wrote under the old line are silently destroyed, a reworded line loses its struck-boform, and after= anchors naming the old id e on a line with children or on a rewordedline.                                                                                                              2. Reword stamps inherited markers as the rh passes the row's effectiverelevance/argument unconditionally (planner.tsx:678-682) while judge correctly diffs own-vs-inherited; renaming a  base-judged row writes a marker the reader
3. Composed foreign drags never record knowstr_sources. planRecordForeignSource is only called on the legacy path  (dnd.tsx:588); the composed branch (:351-38rojected rows satisfy composedMove via therow.projected === true disjunct — so the embed won't resolve after a future fetch. This is an explicit 3.4-series  requirement; the new test at EmbedProjectioritten rows that fall to the legacy path.
4. Self-drop out-dent is still a silent no-op (DroppableContainer.tsx:102-108 discards, drop() bails) — one of the three diagnosed 3.4b DnD regressions, still:387-391 returns the base plan for projectedrows — a user drag that does nothing, silently.
5. Latent core divergences from compose.py, absorption scan is gated on a projectingroot (composition.ts:594-616), so an own-rooted overlay that places targets deeper never populates the absorbed set — the reader's row renders twice; unresolvablped where Python synthesizes dangling rows(:543-553 vs compose.py:593-606) — reachable in a partially synced graph; rowTargets counts struck links in the
non-speaking branch where Python's classifyinto claim records; followAnchors uses aninvented max(10, 2·n²) bound vs. Python's literal 10 (:387-391).
6. planSetSubtreeExpanded runs one full comsx:870-905 calling getTreeChildrenrecursively) — Cmd+Down on a large embed is O(rows) whole-note compositions.
7. The gate is not reliably green. Two dragjection.test.tsx:835, :886) failed on 2 of 3full-file runs with 10s tree-convergence timeouts (watcher startup race — a failure mode OVERLAY_SCENARIOS.md itself
admits). "Keep the repo green at all times"

Coding-standard violations

- Parallel logic (the cardinal ban): three ee-way dispatch fork duplicated acrossuseNodeItemContext.ts/batchOperations.ts; getPreviousSiblingFromRows byte-identical in Node.tsx:533-551 and batchOperations.ts:260-278; two visible-parextended, batchOperations.ts:244-258duplicated); two link-recognition systems that already disagree; the ComposedRow literal assembled three times in     core (composition.ts:566, :905, :975) becaur ported; planner.tsx:694-705 re-encoding the embed shape that core's rowKind decodes.                                                                              - Nine new casts in the core (composition.t[], ["cycle"] as ComposedRow["flags"], …),plus treeTraversal.ts:186. Casts are flatly banned; a typed bonds return type removes all nine.                       - Dead code: the place gesture has a type,  (composition.ts:92, planner.tsx:650-661);CompositionResult.claims and diagnostics are computed on every compose and consumed by nothing;                       updateViewPathsAfterMoveNodes/bulkUpdateVie still ceremonially called; thecomposeLayerFn parameter is threaded through resolveRow/place with every call site passing the same in-scope          function.
- Optionality growth: Row gained composed?, projected?, standsFor?, viewStateKey on top of surviving materialize?;    write-side fields (scope, writeParent, writreaded through the supposedly pureComposedRow; defensive ??/?. chains through planner.tsx.                                                              - Invented files: REVIEW.md, bug.md (a fixeSCENARIOS.md, RECURSIVE_SCENARIOS.md arecommitted at the repo root. Planning truth lives in deedsats-docs; the scenario matrices duplicate what the test      files already are and will rot on the next
- A silently accepted accessibility regression: nine "Navigate to X" labels became bare "X" (Node.tsx:386-401 renders href-less links with no aria-label) and theather than the labels carried over.

The tests themselves are largely clean — pale-tree assertions, live-then-reload doublechecks. Two soft spots: file-level assertions remain partial (toContain/regex counts) instead of the unused
whole-file expectMarkdown (testFixtures/worection.test.tsx still inlines therender+expand boilerplate ~46 times.

What I would do differently

The remaining work is mostly deletion, and I'd sequence it as the route's step 4, executed for real:

1. Make the door total, one gesture family per checkpoint, each checkpoint deleting its legacy path. Every move is a
gesture — including Tab indent/outdent and g routes through applyGesture, delete thecomposedMove predicate, the ~238 legacy dnd lines, planMaterializeComputedRow, and Row.materialize in the same
change. No row.composed ? fork may survive
2. Purify the seam: Gesture takes ids, not pane-indexed view paths (the path fields are already unread — delete
them); view migration moves to the caller; es into core next to its decoder; recognition unifies on one module so planner and core can't disagree.
3. Finish fold state as one mechanism: keeping, delete copyViewsWithNewPrefix and theper-gesture migration entirely, collapse the two key spaces.
4. Re-tighten the core to the literal port:tics (or give them their Phase-2 consumernow), the nine casts, the composeLayerFn parameter, and the 1da8d6e cascade — if the cascade fixes something real,land the lab fixture that proves it in the ke_row; align rowTargets with classify;restore dangling-row synthesis for unresolved children.                                                           5. Fix the four live bugs, each pinned by aas a move (preserving descendants, struckbonds, and dependent anchors) instead of delete-and-mint; reword diffing own-vs-inherited markers; composed foreigdrags recording knowstr_sources; self-drop
6. Deflake the two drag tests and delete the four root docs (fold anything durable into deedsats-docs). A gate thafails 2 of 3 runs is red.
                                                                                                                  What is worth keeping
                                                                                                                  - src/core/composition.ts minus its warts —ithful (verified line-by-line againstcompose.py and empirically at 120/120); it needs the cleanups above, not a restart.                               - The transferred corpus and its harness — r (throws on incomplete fixture dirs, exactfull-tree comparison, dynamic discovery). Worth adding the lab's manifest pinning and duplicate-id rejection.     - Essentially all ~4,900 lines of new testsGeometry suites, which drive real dragoverhover geometry and permanently enforce "manual gesture is part of acceptance," and the great-grandchild no-fold tethe mandate demanded.
- The door's move machinery (positionRows/repairSourceDependents — matured from the parked WIP into tested anchor re-aiming with scope confinement) and the r once it becomes the only fold mechanism.

The one-sentence summary: the branch finallproved it against the oracle — then bolted it to the chassis it was supposed to replace, and the last commits started tuning the bolts instead of removing the old engine.
