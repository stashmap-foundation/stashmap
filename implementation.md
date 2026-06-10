# Knowstr collaboration model v2 implementation plan

This plan implements `idea.md`. Phase 0 is intentionally removal-only: delete the incompatible legacy ingestion paths before adding the v2 source/import/suggest model.

## Phase 0 — Remove legacy `apply` / `inbox` ingestion — Done

### Goal

Remove the current workflow that silently ingests markdown from `./inbox` into the editable workspace. This code is incompatible with the v2 rule that sources are read-only and crossing from source to workspace must be explicit through `import` or accepting/copying a derived suggestion.

Do not add the new v2 commands in this phase. Keep this phase focused on deleting legacy behavior and keeping existing non-legacy workspace functionality green.

### Incompatible behavior to remove

- `knowstr apply` CLI command.
- `./inbox` as a magic staging area.
- Automatic insertion of incoming/source node IDs into editable workspace files.
- Creation of materialized `(?)` nodes from inbox files.
- Creation of `maybe_relevant/` files from unknown inbox documents.
- Writing `knowstr_log.md` as part of merge/apply flow.
- Clearing/deleting inbox files after applying.
- Hardcoded workspace-scan behavior that reserves/ignores `inbox/` only for the old apply workflow.

### Files expected to change

- Delete or fully disconnect:
  - `src/cli/apply.ts`
  - `src/infra/filesystem/workspaceApply.ts`
  - `src/cli/apply.test.ts`
- Update:
  - `src/cli/main.ts`
  - `src/cli/main.test.ts`
  - `src/infra/filesystem/workspaceScan.ts`
  - `src/cli/save.test.ts`
  - `src/testFixtures/workspace.ts`
- Check generated/build artifacts only if this repo expects them to be committed:
  - `dist/cli/apply.js`
  - any `dist/*workspaceApply*` files

### Tests first

- Update CLI dispatch/help tests so `apply` is no longer listed or dispatched.
- Remove apply-specific tests rather than rewriting them around v2 semantics.
- Update save tests that assert `inbox/` is ignored only because it was special. After Phase 0, `inbox/` should be ordinary workspace content unless ignored by `.knowstrignore` or, in a later phase, configured as a source.
- Keep existing `init`, `save`, filesystem, and markdown round-trip tests passing.

### Implementation steps

1. Remove `apply` imports, help text, and command dispatch from `src/cli/main.ts`.
2. Delete the `runApplyCommand` surface and apply implementation.
3. Remove `knowstrApply` and related helper types from `src/testFixtures/workspace.ts`.
4. Remove `RESERVED_WORKSPACE_IGNORES = ["inbox/"]` from workspace scanning.
5. Delete or update tests that encode the legacy apply/inbox behavior.
6. Ensure no remaining source code references `workspaceApply`, `runApplyCommand`, `applyHelp`, `maybe_relevant`, or `knowstr_log.md` as part of an ingestion flow.

### Acceptance criteria

- `knowstr apply` is no longer a valid command.
- General CLI help no longer lists `apply`.
- No production code scans `./inbox` as a special ingestion source.
- No production code creates `maybe_relevant/` as part of source ingestion.
- No production code writes `knowstr_log.md` as part of source ingestion.
- `knowstr save` no longer treats `inbox/` specially; source exclusion will be implemented later through source configuration.
- Existing non-legacy workspace normalization and desktop write-through behavior still works.

### Verification

Run focused checks first:

```sh
npm test -- src/cli/main.test.ts src/cli/init.test.ts src/cli/save.test.ts --runInBand
npm test -- src/infra/filesystem/workspaceBackend.test.ts src/desktop/FilesystemWriteThrough.test.tsx --runInBand
```

Then run standard checks:

```sh
npm run typescript
npm run lint
npm test
```

### Out of scope for Phase 0

- Adding `knowstr source`.
- Adding `knowstr import`.
- Adding `knowstr suggest`.
- Adding `knowstr show`.
- Implementing `.knowstr/sources.json`.
- Implementing `.knowstr/snapshots/`.
- Reworking UI/Nostr suggestion rendering beyond what is necessary to remove the legacy CLI apply/inbox path.

## Draft phase order

These phases are scope/order placeholders only. `(draft)` means the phase is not yet detailed enough to implement; before starting any draft phase, expand it with tests-first steps, exact files/functions, acceptance criteria, and verification commands.

The first five phases are intentionally ordered to validate whether the source/import/suggest model works in practice before investing in all surrounding polish. Local filesystem snapshot storage is pulled forward because `import` cannot be correct if Electron/CLI workspaces still rely on IndexedDB-only snapshot durability.

## Phase 1A — Namespace-scoped ID foundation (split)

Phase 1A is now split into smaller green checkpoints. Do not start Phase 1B until the Phase 1A final acceptance criteria below are met.

Definitions:

- **Done** means committed and verified with `npm run typescript`, `npm run lint`, and `npm test`.
- **Remaining** phases must be implemented as small checkpoints. Run the full verification after each checkpoint. Do not use `--runInBand` for normal verification.
- Do not add legacy public-key migration/splitting logic. If old helper behavior remains temporarily, it is only compatibility debt to delete or isolate.

### Phase 1A.1 — Source-aware read lookup foundation — Done

Goal: introduce source-scoped graph identity and a central read-side lookup foundation while keeping existing behavior green.

Status: **Done in commit `ec10ecb` (`Add source-aware graph lookup foundation`)**.

Completed:

- Added `SourceId`, `NodeRef`, and source fields on pane/reference-row boundaries.
- Added `src/core/graphLookup.ts` with functional lookup helpers:
  - exact source lookup;
  - local fallback to deterministic source candidates;
  - no fallback from non-local sources;
  - same-source parent/child/link traversal.
- Added `src/core/planLookup.ts` for planner-safe lookup that does not use `graphIndex`.
- Updated `src/graphIndex.ts` to maintain source-scoped node maps and candidate refs while keeping legacy compatibility fields internal.
- Added tests for source-aware lookup and source-indexed graph indexing:
  - `src/core/graphLookup.test.ts`;
  - `src/graphIndex.test.ts`.
- Added lint restrictions blocking ordinary direct reads of:
  - `graphIndex.nodeByID`;
  - `graphIndex.nodesBySource`;
  - `graphIndex.sourceCandidatesById`.
- Added planner lint restrictions against importing graph-index-backed lookup modules or reading `*.graphIndex` members.
- Migrated initial read paths for search/reference/semantic projection to use `GraphLookup` where needed.
- Added `Pane.sourceId` serialization and user-session handling.
- Switched node routes built by app code to `/r/<id>?source=<source-id>` and removed `?author=` route parsing compatibility.
- Added markdown ID safety validation at parse boundaries.
- Verified green with:
  - `npm run typescript`;
  - `npm run lint`;
  - `npm test`.

Known remaining debt after this checkpoint:

- `LongID` is still widely used.
- `joinID`, `shortID`, and `splitID` are still central to concrete node identity.
- Generated node IDs are still author-prefixed.
- Many `sourceId` values are still derived from `author`; source is carried, but not yet fully independent from author identity.
- Some read/view helpers still use author-scoped `getNode` paths and must be audited for duplicate-source-ID correctness.
- Route/pane parsing still has some fallback paths that infer source from ID shape when no `source` query is present.
- `GraphPlan` still carries `graphIndex` as data, even though planner code is linted against reading `*.graphIndex` members.

### Phase 1A.2 — Source propagation and read-callsite closeout — Done

Goal: all read/render/navigation layers that carry a node ID also carry the source explicitly, and duplicate IDs across sources render/navigate correctly.

Tests first:

- Integration tests for duplicate source node IDs across followed/read-only sources covering:
  - reference rows;
  - incoming refs;
  - suggestions/versions where applicable;
  - search rows;
  - breadcrumbs/navigation;
  - split-pane/open/fullscreen flows.

Implementation checkpoints:

1. Audit remaining `getNode`, `getChildNodes`, `resolveNode`, `shortID`, and `splitID` callsites in read/render/UI paths.
2. Migrate source-sensitive read callsites to `graphLookup.ts` helpers or already-resolved `NodeRef`/`ResolvedNode` values.
3. Ensure `Pane`, `ReferenceRow`, virtual rows, search rows, incoming refs, version refs, breadcrumbs, and navigation targets preserve `sourceId` without re-inferring it from `GraphNode.author` or ID shape.
4. Remove route/pane source fallbacks that depend on `splitID(nodeID)` once all app-generated routes include `?source=`.
5. Keep planner mutation paths on `planLookup.ts`, existing `knowledgeDBs`, or already-resolved refs; planner code must not use graph-index-backed lookup.
6. If `GraphPlan` still carries `graphIndex`, either remove it from plan data or keep it documented as temporary unreachable state protected by lint.

Acceptance criteria:

- Duplicate IDs from different sources display and navigate independently in real UI flows.
- Once a source candidate is selected, all parent/child/link traversal stays in that source.
- App routes require/carry `?source=` for `/r/<id>` navigation; source is not recovered from ID prefixes in ordinary route handling.
- Ordinary UI/rendering code does not read `nodeByID`, `nodesBySource`, or `sourceCandidatesById` directly.
- Planner code has no graph-index-backed lookup access.
- `npm run typescript`, `npm run lint`, and `npm test` pass after each checkpoint.

### Phase 1A.3 — Bare markdown IDs and local uniqueness — Done

Goal: safe explicit IDs from markdown/import boundaries are preserved as bare local IDs, including underscores, while generated IDs remain UUID-based and local workspace duplicates are rejected.

Status: **Done**.

Completed:

- Added CLI workspace-save integration tests proving safe explicit IDs (`foo_bar`, `foo-bar`, `foo:bar`, `custom.id`) persist exactly through `knowstr save` and a disk readback.
- Added CLI workspace-save integration coverage rejecting unsafe HTML-comment IDs.
- Added an explicit filesystem markdown materialization boundary that preserves explicit IDs without changing ordinary app/Nostr document parsing.
- Normalized local document rendering, document membership, document event materialization, and graph indexing around exact local node IDs.
- Verified green with `npm run typescript`, `npm run lint`, and `npm test`.

Tests first:

- Markdown parse/materialize/render round-trip preserving safe explicit IDs such as:
  - `foo_bar`;
  - `foo-bar`;
  - `foo:bar`;
  - `custom.id`.
- Tests proving safe explicit markdown IDs are not passed through `joinID`, `splitID`, or `shortID` transformations.
- Validation tests rejecting unsafe IDs in HTML-comment attributes.
- Workspace save/materialization tests rejecting duplicate local node IDs across local workspace documents.
- Tests allowing duplicate IDs across different source graphs as separate candidates.

Implementation checkpoints:

1. Keep ID validation at markdown/import boundaries.
2. Materialize explicit markdown IDs as exact `GraphNode.id` values when they are safe and unique.
3. Preserve explicit IDs during render/save without converting underscores or adding author/public-key prefixes.
4. Keep generated IDs UUID-based. Do not mix this checkpoint with a broad generated-ID shape rewrite.
5. Normalize local duplicate checking around exact local IDs, not split/short IDs.

Acceptance criteria:

- Bare IDs from markdown are preserved exactly.
- IDs with underscores are not corrupted.
- Local editable workspace node IDs are globally unique across local workspace documents.
- Duplicate IDs across sources are represented as source candidates, not collapsed.
- Existing editor/tree behavior remains green.

### Phase 1A.4 — Remove author-prefixed concrete identity helpers from ordinary domain code — Done

Goal: stop treating concrete node identity as `author_id`. Source/read-only/editable semantics must come from `sourceId`/`NodeRef`, not ID shape.

Status: **Done**.

Completed:

- Removed `joinID`, `shortID`, `splitID`, and `localNodeID` usage from source code.
- Deleted the temporary legacy node-ID compatibility module.
- Generated graph node IDs are now bare UUIDs.
- Knowledge DB and graph-index node maps now use exact `node.id` keys only; underscore-containing IDs are treated as opaque IDs, not parsed prefixes.
- Updated reference/search/incoming/version/deep-copy flows to carry source through lookup/navigation instead of relying on ID prefixes.
- Added generated-ID and opaque underscore-ID coverage.
- Verified green with `npm run typescript`, `npm run lint`, and `npm test`.

Prerequisites:

- Phase 1A.2 is green.
- Phase 1A.3 is green.
- All relevant boundaries carry source explicitly.

Tests first:

- Existing editor/tree/focus tests remain green.
- Route/navigation tests prove `/r/<bare-id>?source=<source-id>` works for bare local and source IDs.
- Tests proving generated nodes are UUID-based and do not need public-key prefixes for lookup correctness.

Implementation checkpoints:

1. Replace `joinID` callsites with explicit UUID generation, exact local IDs, or `NodeRef`/source-aware APIs as appropriate.
2. Replace `shortID` callsites with exact-ID behavior or narrow display-only helpers that do not imply lookup semantics.
3. Replace `splitID` callsites with explicit `sourceId` plumbing; do not parse source from node ID shape.
4. Prefer deleting `joinID`/`shortID`/`splitID` over turning them into semantic no-ops.
5. Delete transitional ID-splitting helpers instead of introducing legacy public-key compatibility paths.

Acceptance criteria:

- Ordinary domain/read/render/planner code no longer depends on author/public-key prefixes in node IDs.
- Source identity is carried by `NodeRef.sourceId` or equivalent boundary state.
- Generated node IDs are UUID-based without relying on author prefixes for uniqueness inside the local source.
- No legacy public-key migration behavior is introduced.
- `npm run typescript`, `npm run lint`, and `npm test` pass after each checkpoint.

### Phase 1A.5 — Source-aware row identity and planner NodeRef boundary — Done

Status: **Done in commits `34286bb` (`Implement source-aware node and row identity`) and `16ac683` (`rename viewContext.tsx into rowModel.tsx`)**.

The detailed execution prompts live in `row-model-plan.md`, `implementation/01-delete-view-path.md`, and `implementation/02-delete-view-lookups.md`.

Completed:

- `treeTraversal` returns ordered `Row` values as the editor model; virtual rows are rows, not side-map entries.
- Editor rendering, multiselect, DnD payloads, and editor actions work from `Row` values.
- Planner/core mutation functions receive `NodeRef`/explicit graph inputs; they do not accept `Row`, `ViewPath`, or `viewKey` as graph identity.
- Deleted `ViewContext` (file renamed to `rowModel.tsx`), `useViewPath`, `getNodeForView`, `getRowIDFromView`, `getPaneRootViewPath`, `VirtualRowsMap`, and `findUniquePlanNodeByID`.
- `GraphNode.virtualType` / `GraphNode.versionMeta` moved to `Row`; no view-key keyed identity maps exist.
- All hard grep acceptance gates from `row-model-plan.md` and `implementation/02-delete-view-lookups.md` are clean.
- Verified green with `npm run typescript`, `npm run lint`, and `npm test` (74 suites, 841 tests).

### Phase 1A.5b — Performance closeout — In progress

The row migration roughly doubled full-suite test time (about 30s before, about 63s now; `src/editor/IncomingRefInteraction.test.tsx` is the long pole and is byte-identical before/after the migration). See `performance-regression.md` for measured per-item status — several earlier suspects were profiled and disproved there; do not re-investigate them without new evidence.

Resolved:

- `findUniquePlanNodeByID` / `knowledgeDBs.valueSeq()` planner scans are deleted.
- `buildReferenceItem` and reference-row helpers receive `graph` as a parameter instead of constructing lookups repeatedly.
- Per-row-render `nip19.decode` on arbitrary node text (`getNodeUserPublicKey` via `getDisplayTextForRow`/`Node`/`RightMenu`) is fixed with a key-shape guard in `src/infra/nostr/publicKeys.ts` (~2s full-suite win).

Remaining:

- Attribute the residual slowdown (diffuse per-event/render cost and idle timer waits) via a baseline timing comparison against the pre-migration commit; see open leads in `performance-regression.md`.
- Minor cleanups: `nodeTarget` in `src/editor/linkOperations.ts` constructs `graphLookupFromData(data)` per link (measured cheap); delete dead/test-only traversal exports `getTreeChildrenForRow` / `getTreeChildren`.

Acceptance criteria:

- No `graphLookupFromData(data)` construction inside per-row or per-link render paths; a traversal/render pass creates lookup data once and passes it through.
- No hot-path fallback that scans all DBs/all nodes to resolve a semantic or concrete node ID.
- Full-suite `npm test` wall time returns to roughly the pre-migration baseline (~30–40s), with the residual attributed via baseline comparison first.
- `npm run typescript`, `npm run lint`, and `npm test` pass.

### Phase 1A.6 — Remove remaining `LongID` assumptions incrementally — Remaining

Goal: remove the temporary `LongID` model where it no longer represents a real domain distinction.

Tests first:

- Public API and integration tests around:
  - block links;
  - file links;
  - parent/root traversal;
  - route parsing/building;
  - serialization/deserialization;
  - copy/import-style planner operations.

Implementation checkpoints:

1. Audit all `LongID` uses and classify them as:
   - exact local `ID`;
   - source-scoped `NodeRef`;
   - route/path string;
   - unresolved external reference;
   - true temporary compatibility debt.
2. Replace `LongID` with `ID` or `NodeRef` where source is already explicit.
3. Keep unresolved external references narrow and parse them at boundaries.
4. Avoid broad casts. Use narrowing and typed boundary parsers instead.
5. Run the full suite after each narrow type replacement.

Acceptance criteria:

- Remaining long/scoped references are represented by explicit data, not by a string alias that hides source state.
- New code does not introduce `LongID` assumptions.
- Any leftover `LongID` use is documented as temporary compatibility debt with a deletion path.
- `npm run typescript`, `npm run lint`, and `npm test` pass.

### Phase 1A final acceptance criteria

Phase 1A is complete only when all of the following are true:

- Node IDs are opaque strings: code compares them directly and does not split or join embedded metadata. `LongID` is deleted.
- `npm run typescript`, `npm run lint`, and `npm test` pass without `--runInBand`.
- Existing editor/tree typing, Enter/Tab insertion, row focus, breadcrumbs, and pane behavior remain green.
- Ordinary UI/rendering code never reads graph-index internals directly.
- Planner code has no access to graph-index-backed lookup.
- Planner and mutation functions use `NodeRef`/resolved row metadata for concrete node identity; `ViewPath` is only UI occurrence state.
- Lookup behavior is implemented once in functional helpers and matches the four core lookup rules:
  1. resolve in the current source first;
  2. if not found and current source is local, try source candidates in deterministic source order;
  3. if current source is non-local, stop;
  4. once selected, parent/child/link traversal stays in that source.
- Source identity is carried as `NodeRef.sourceId` or equivalent explicit boundary state, not inferred from `GraphNode.author` or ID shape.
- Bare IDs in markdown are preserved exactly, including IDs with underscores.
- Duplicate IDs across sources are represented as candidates and are not collapsed into one global node value at callsites.
- `joinID`, `shortID`, `splitID`, and `LongID` have either been removed from ordinary domain code or isolated/documented as temporary compatibility debt with a deletion path.
- No legacy public-key migration behavior exists.

## Phase 1B — Node-level lineage metadata and hash snapshot IDs (draft)

Second half of the former metadata phase. Do this after Phase 1A so `basedOn` and snapshot lookup can use the namespace-scoped ID model.

### Decisions to encode

- Rename the internal `snapshotDTag` concept to `snapshotId`. A Nostr snapshot event may use the same value as its `d` tag, but the model concept is a content-addressed snapshot ID.
- Valid snapshot IDs are hash-shaped: `snap_sha256_<64 lowercase hex chars>`.
- `snapshot` is node-level metadata. Preserve, parse, and render it on every node, not just roots.
- Node-level snapshot lookup uses only the node's own `snapshotId`. Do not fall back to root/document snapshot metadata for a node's lineage edge.
- `basedOn` parsing/rendering remains supported and should use the Phase 1A scoped-ref model for cross-namespace references.
- Preserve `knowstr_vote_id` in frontmatter.
- Whole-document snapshots are sufficient for now. The ID/lookup model should not prevent subtree snapshots later, but this phase does not need to create subtree snapshots.

### Tests first

- Add markdown parser/materializer/renderer tests proving `snapshot` survives on child headings, list items, paragraphs, block links, and file links.
- Add tests proving `basedOn` round-trips with scoped refs and local refs.
- Add tests proving `knowstr_vote_id` survives save/round-trip.
- Add tests for rejecting malformed `snapshot` IDs in filesystem save paths.
- Add snapshot baseline tests proving lookup uses the node's own `snapshotId` only, with no root fallback.

### Implementation notes

- Update `GraphNode` and related functions from `snapshotDTag` to `snapshotId` where practical.
- Update snapshot stores/materialization to key by snapshot ID terminology.
- Current snapshot creation that uses mutable/non-hash IDs such as `snapshot-${document.docId}` must be removed or replaced before paths that create snapshots are considered valid v2 behavior.
- Filesystem/CLI parsing should throw clear validation errors for malformed local workspace markdown. Remote/Nostr ingestion should avoid crashing the app on malformed remote documents.

### Acceptance criteria

- `knowstr save` preserves node-level `basedOn`, `snapshot`, and `knowstr_vote_id` metadata.
- Node-level snapshots are accepted only with `snap_sha256_<64 lowercase hex chars>` IDs.
- Snapshot diff/baseline lookup for a node uses that node's own snapshot ID and does not inherit from root metadata.
- Existing non-legacy save/render/navigation behavior remains green.

## Phase 2 — `knowstr source` (draft)

Former source registry phase. This is the minimal source declaration layer needed to try the model.

Minimal prerequisite: add `.knowstr/sources.json` support.

- Add `knowstr source add <file-or-dir>`.
- Add `knowstr source list`.
- Add `knowstr source remove <file-or-dir>`.
- Require existing `.knowstr`; do not initialize implicitly.
- Do not copy, rewrite, normalize, delete, or fork source files.
- Store source paths in workspace state.
- Exclude configured source paths from workspace save.
- Exclude configured source paths from filesystem workspace watching/write-through where relevant.

## Phase 3 — Local filesystem snapshot storage for Electron/CLI workspaces (draft)

Pulled forward before `import`. A filesystem workspace must durably store snapshots under `.knowstr/snapshots/`; IndexedDB can remain a cache/browser/Nostr-only fallback but must not be the only durable store when running in Electron or CLI workspace mode.

- Add snapshot storage primitives for initialized filesystem workspaces.
- Store immutable snapshot markdown at `.knowstr/snapshots/<snapshot-id>.md`.
- Use content-addressed IDs where practical, e.g. `snap_sha256_<hash>`.
- Add lookup by snapshot ID for CLI and Electron filesystem runtime.
- Keep IndexedDB snapshot storage/caching for browser/Nostr-only mode.
- Ensure snapshot creation is explicit and happens for import/copy/accept, not ordinary suggest.
- Ensure snapshot writes are idempotent and never mutate existing snapshot content.
- Make Electron filesystem mode prefer local `.knowstr/snapshots/` over IndexedDB for durable snapshot baselines.

## Phase 4 — `knowstr import` explicit fork workflow (draft)

Former import phase. This is the first explicit crossing from source into editable workspace.

- Require initialized workspace.
- Read a source markdown file.
- Register the source if needed, unless already covered by a source directory.
- Create an immutable durable snapshot of the source as seen now using the local snapshot store from Phase 3.
- Create a fresh `knowstr_doc_id` for the local workspace document.
- Mint new local node IDs.
- Copy visible content and tree structure.
- For source nodes with IDs, write `basedOn` to the source node ID.
- Write node-level `snapshot` for every copied node with `basedOn`.
- Preserve `knowstr_vote_id`.
- Write the editable fork to the requested workspace path.

## Phase 5 — `knowstr suggest` read-only proposal computation (draft)

Former suggest phase. This validates whether suggestions can be derived without apply/inbox/log state.

- Require initialized workspace with source configuration.
- Read configured sources.
- Keep source files read-only.
- Compare source lineage/IDs against the local workspace graph.
- Use existing `basedOn` + node-centric `snapshot` baselines where available.
- Find additions/variants relevant to local workspace documents.
- Suppress already-known proposals from graph state and lineage, not from a run log.
- Do not insert source nodes into editable workspace files.
- Do not create snapshots during ordinary suggestion computation.
- Print text summary by default.
- Support `--json`.
- Support `--dry-run` if useful, but ordinary suggest should already be non-mutating.

## Why phases 1–5 come first

This lets us test the core loop quickly:

```sh
knowstr source add /shared/alice.md
knowstr import /shared/alice.md holidays.md
knowstr suggest --json
```

Then we can manually inspect whether:

- lineage is useful,
- snapshots are sufficient,
- source read-only boundaries feel right,
- suggestions can be derived without logs/status files.

The only caveat: `source`, local snapshots, and `import` need small pieces from the broader workspace foundation. Implement only the minimum needed in phases 2–4 instead of doing a big infrastructure phase first.

## Phase 6 — Workspace state foundation hardening (draft)

Former workspace foundation phase, moved after the first model-validation loop.

- Complete explicit workspace semantics.
- Ensure `knowstr init` creates all required workspace state:
  - `.knowstr/profile.json`
  - `.knowstr/sources.json`
  - `.knowstr/snapshots/`
  - optional `.knowstr/me.nsec`
- Add shared helpers for requiring an initialized workspace.
- Add shared helpers for loading/saving source config.
- Add shared helpers for snapshot path/hash lookup.
- Ensure no command except `init` creates `.knowstr`.
- Ensure commands that need persistent workspace state fail clearly when no initialized workspace exists.

## Phase 7 — `knowstr save` v2 behavior (draft)

Former save phase, moved after source/import/suggest validation.

- Split save into standalone explicit-path mode and workspace mode.
- `knowstr save file.md dir/` works without `.knowstr`.
- Standalone save scans only explicit paths.
- Standalone save assigns missing `knowstr_doc_id` and node IDs.
- Standalone save preserves `basedOn`, `snapshot`, and `knowstr_vote_id`.
- Standalone save rejects duplicate document IDs and node IDs within the explicit file set.
- `knowstr save` with no explicit paths is workspace mode and requires `.knowstr`.
- Workspace save excludes `.knowstr`, ignored files, and configured sources.
- Save never creates snapshots.
- Save never creates `.knowstr`.

## Phase 8 — Accept/copy suggestion semantics (draft)

Former accept/copy phase.

- Update existing UI/planner copy paths to match v2 semantics.
- Accepting/copying suggestions mints local IDs.
- Accepting/copying source nodes never inserts source node IDs as editable local node IDs.
- Every copied node with `basedOn` gets or resolves a node-centric `snapshot` baseline.
- Reuse the same snapshot primitives as `import` where possible.
- Make CLI-derived suggestions and UI-derived suggestions converge on the same lineage behavior.

## Phase 9 — `knowstr show` read-only render/export (draft)

Former show phase.

- Add `knowstr show <address>`.
- Support `/d/<author>/<doc-id>` document addresses.
- Support `/r/<node-id>` subtree addresses.
- Render visible document/node as portable markdown.
- Preserve enough frontmatter for safe export.
- Preserve `knowstr_vote_id` when present.
- Do not import.
- Do not save.
- Do not register sources.
- Do not create editable IDs.
- Do not create `.knowstr`.

## Phase 10 — Desktop/UI source settings and overlays (draft)

Former UI phase, after CLI semantics are proven.

- Add source settings UI.
- Show configured read-only sources.
- Add import/fork source action.
- Show source-backed suggestions as local overlays.
- Keep source files read-only in filesystem UI.
- Ensure UI source import/accept paths use the same lineage/snapshot semantics as CLI.

## Phase 11 — Regression, cleanup, and docs (draft)

Final v1 hardening phase.

- Run full test suite and static checks.
- Remove remaining legacy terminology from code/help/docs.
- Update README/CLI help for v2 workflows.
- Verify `idea.md` safety invariants one by one.
- Document explicitly deferred work.

## Future phase — `knowstr fork` convenience wrapper (draft)

Optional later wrapper around:

```sh
knowstr show <address> > temp.md
knowstr import temp.md <workspace-path>
```

It must require an initialized workspace and must not introduce semantics different from import.

## Future phase — `knowstr aggregate` voting aggregates (draft)

Optional later voting/ranking command based on `knowstr_vote_id`. Not needed for v1 model validation.

## Future phase — Remove author significance from concrete node identity (draft)

Longer-term migration from internal `author_uuid` graph IDs to globally unique UUID node IDs. Do this only after v2 workspace/source semantics are stable.
