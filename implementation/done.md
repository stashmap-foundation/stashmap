# Completed phases (archive)

Historical record of completed groundwork, moved out of `implementation.md`. Nothing here is a work item; see `implementation.md` for the active plan. Detailed execution prompts for the row-model migration live in `01-delete-view-path.md` and `02-delete-view-lookups.md`.

## Phase 0 — Remove legacy `apply` / `inbox` ingestion — Done

Removed the workflow that silently ingested markdown from `./inbox` into the editable workspace — incompatible with the rule that sources are read-only and crossing from source to workspace must be explicit.

Removed:

- `knowstr apply` CLI command (`src/cli/apply.ts`, `src/infra/filesystem/workspaceApply.ts`, tests).
- `./inbox` as a magic staging area; `RESERVED_WORKSPACE_IGNORES = ["inbox/"]`.
- Automatic insertion of incoming/source node IDs into editable workspace files.
- Creation of materialized `(?)` nodes from inbox files.
- Creation of `maybe_relevant/` files from unknown inbox documents.
- Writing `knowstr_log.md` as part of merge/apply flow.

Acceptance held: `apply` is not a valid command; no production code scans `./inbox`, creates `maybe_relevant/`, or writes `knowstr_log.md`; `save` treats `inbox/` as ordinary workspace content; non-legacy workspace normalization and desktop write-through still work.

## Phase 1A — Namespace-scoped ID foundation — Done

### Phase 1A.1 — Source-aware read lookup foundation — Done

Done in commit `ec10ecb` (`Add source-aware graph lookup foundation`).

- Added `SourceId`, `NodeRef`, and source fields on pane/reference-row boundaries.
- Added `src/core/graphLookup.ts` with functional lookup helpers: exact source lookup; local fallback to deterministic source candidates; no fallback from non-local sources; same-source parent/child/link traversal.
- Added `src/core/planLookup.ts` for planner-safe lookup that does not use `graphIndex`.
- Updated `src/graphIndex.ts` to maintain source-scoped node maps and candidate refs.
- Added lint restrictions blocking ordinary direct reads of `graphIndex.nodeByID`, `graphIndex.nodesBySource`, `graphIndex.sourceCandidatesById`; planner lint restrictions against graph-index-backed lookup.
- Migrated initial read paths for search/reference/semantic projection to `GraphLookup`.
- Added `Pane.sourceId` serialization; switched node routes to `/r/<id>?source=<source-id>`; removed `?author=` route parsing.
- Added markdown ID safety validation at parse boundaries.

### Phase 1A.2 — Source propagation and read-callsite closeout — Done

All read/render/navigation layers that carry a node ID also carry the source explicitly; duplicate IDs across sources render and navigate independently; once a source candidate is selected, traversal stays in that source; planner code has no graph-index-backed lookup access.

### Phase 1A.3 — Bare markdown IDs and local uniqueness — Done

- CLI workspace-save integration tests proving safe explicit IDs (`foo_bar`, `foo-bar`, `foo:bar`, `custom.id`) persist exactly through `knowstr save` and a disk readback; unsafe HTML-comment IDs rejected.
- Explicit filesystem markdown materialization boundary preserving explicit IDs without changing app/Nostr document parsing.
- Local document rendering, document membership, document event materialization, and graph indexing normalized around exact local node IDs.
- Generated IDs remain UUID-based; local workspace duplicates rejected; duplicates across sources represented as candidates, not collapsed.

### Phase 1A.4 — Remove author-prefixed concrete identity helpers — Done

- Removed `joinID`, `shortID`, `splitID`, and `localNodeID` usage from source code; deleted the temporary legacy node-ID compatibility module.
- Generated graph node IDs are bare UUIDs; knowledge DB and graph-index node maps use exact `node.id` keys only; underscore-containing IDs are opaque, not parsed prefixes.
- Reference/search/incoming/version/deep-copy flows carry source through lookup/navigation instead of relying on ID prefixes.

### Phase 1A.5 — Source-aware row identity and planner NodeRef boundary — Done

Done in commits `34286bb` (`Implement source-aware node and row identity`) and `16ac683` (`rename viewContext.tsx into rowModel.tsx`). Execution prompts: `row-model-plan.md`, `01-delete-view-path.md`, `02-delete-view-lookups.md`.

- `treeTraversal` returns ordered `Row` values as the editor model; virtual rows are rows, not side-map entries.
- Editor rendering, multiselect, DnD payloads, and editor actions work from `Row` values.
- Planner/core mutation functions receive `NodeRef`/explicit graph inputs; they do not accept `Row`, `ViewPath`, or `viewKey` as graph identity.
- Deleted `ViewContext` (renamed to `rowModel.tsx`), `useViewPath`, `getNodeForView`, `getRowIDFromView`, `getPaneRootViewPath`, `VirtualRowsMap`, `findUniquePlanNodeByID`.
- `GraphNode.virtualType` / `GraphNode.versionMeta` moved to `Row`; no view-key keyed identity maps exist.

### Phase 1A.5b — Performance closeout — Parked

Production-relevant regressions are fixed (per-row decode guard, index-based incoming-ref suppression, dead O(N) lookup removal). The residual is test-environment render/event cost, deprioritized; see `performance-regression.md` for measured per-item status — several earlier suspects were profiled and disproved there; do not re-investigate without new evidence.

Remaining leads (parked): attribute the residual slowdown via baseline timing comparison against the pre-migration commit; delete dead/test-only traversal exports `getTreeChildrenForRow` / `getTreeChildren`.

### Phase 1A.6 — Remove remaining `LongID` assumptions — Done

Audited all 160 `LongID` references across 27 files; replaced every `LongID` annotation with `ID` and deleted the alias from `src/types.ts`. `rg "LongID" src` has no hits.

### Phase 1A final acceptance criteria — all met

- Node IDs are opaque strings: code compares them directly and does not split or join embedded metadata.
- Ordinary UI/rendering code never reads graph-index internals directly; planner code has no graph-index-backed lookup.
- Lookup behavior is implemented once in functional helpers: resolve in current source first; local falls back to deterministic candidates; non-local stops; once selected, traversal stays in the source.
- Source identity is carried as `NodeRef.sourceId` or equivalent explicit boundary state, not inferred from `GraphNode.author` or ID shape.
- Bare IDs in markdown are preserved exactly, including underscores; duplicate IDs across sources are candidates, not collapsed.
- No legacy public-key migration behavior exists.

## Phase 1B — Node-level lineage metadata — completed checkpoints

1. **Content-addressed snapshot IDs.** `snapshotDTag` renamed to `snapshotId` across all production files; `buildSnapshotEventFromNodes` derives its ID as `snap_sha256_<sha256(content)>` via `snapshotIdForContent` (`src/nodesDocumentEvent.ts`); the mutable `` `snapshot-${docId}` `` ID and its cast deleted from `src/planner.tsx`. Covered by the fork integration test in `src/editor/DeepCopy.test.tsx`.
2. **Node-level snapshot metadata.** Materialization no longer drops `snapshot` on non-root nodes (`src/core/markdownNodes.ts`). Covered by the parse/render round-trip test in `src/core/Document.test.ts` proving root and child `basedOn`/`snapshot` survive both directions.
3. **Node-centric snapshot stamping and lookup.** Document rendering stamps the created snapshot ID on every node that has `basedOn` without its own `snapshotId` (`src/documentRenderer.ts`); baseline lookup in `src/core/snapshotBaseline.ts` uses the forked node's own `snapshotId` — root fallback and two casts deleted. Covered by the fork integration test in `src/editor/DeepCopy.test.tsx`.

Remaining 1B items moved into the active plan in `implementation.md`.
