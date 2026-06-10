# Performance regression audit

Updated 2026-06-10 after the row-model migration landed (`34286bb`, `16ac683`). Full-suite `npm test` wall time roughly doubled from ~30s to ~65s. `src/editor/IncomingRefInteraction.test.tsx` alone takes ~65s and is the long pole; everything else finishes well before it.

`graphLookupFromData(data)` itself is cheap (it bundles references and builds a small deduplicated source-order array), so the cost is not in constructing the lookup but in what gets recomputed per row.

## Resolved

1. `findUniquePlanNodeByID` and the `knowledgeDBs.valueSeq()` planner scan are deleted. Planner lookup is exact source only. Verified: `rg "findUniquePlanNodeByID|knowledgeDBs\.valueSeq" src` has no production hits.
2. `src/buildReferenceRow.ts` no longer constructs graph lookups repeatedly; `buildReferenceItem` and its helpers receive `graph` as a parameter from the traversal pass.
3. `src/treeTraversal.ts` entry points (`getNodesInTree`, `getNodesInDocument`) construct the graph lookup once per traversal and pass it through.

## Remaining

1. `src/semanticProjection.ts` `getIncomingCrefsForNode` — **main suspect** for the suite slowdown.
   - Called from `getChildrenForRegularNode` in `src/treeTraversal.ts` for every expanded row in a traversal.
   - Per call, `coveredDocumentKeys` recursively walks the row's entire child subtree via `getChildNodes`, so a traversal over a deep tree does O(n²)-shaped subtree walks.
   - Per call, `outgoingTargetRelIDs` source-resolves every child (`resolveBlockLinkTarget` / `resolveNode`).
   - Per call, it dedupes/sorts and calls `getNodeContext` for incoming candidates.
   - Fix direction: restructure the data flow so a traversal computes covered-document/outgoing-target information once top-down instead of re-walking each row's subtree, per the no-caching rule in `AGENTS.md`.
2. `src/editor/linkOperations.ts` `nodeTarget` constructs `graphLookupFromData(data)` per call; `linkToHref` runs during render for every block-link row (`NodeAutoLink` in `src/editor/Node.tsx`). Cheap per call but multiplies in link-heavy views; pass the traversal/render-pass lookup in instead.
3. Dead/test-only traversal exports to delete: `getTreeChildrenForRow` (no callers) and `getTreeChildren` (used only by `src/sourcePropagation.test.ts`).
4. Lower-confidence: `src/semanticProjection.ts` `getConcreteNodesForSemanticID` still scans all candidate DBs/nodes on direct lookup miss. Not confirmed as a hot path, but it is a whole-DB scan and should not be reachable from per-row rendering.

## Acceptance

- No `graphLookupFromData(data)` construction in per-row or per-link render paths.
- No per-row full-subtree re-walks for incoming-ref computation.
- No hot-path all-DB/all-node fallback scans.
- Full-suite `npm test` wall time returns to roughly the pre-migration baseline (~30–40s), with `IncomingRefInteraction.test.tsx` no longer an order of magnitude slower than other suites.
