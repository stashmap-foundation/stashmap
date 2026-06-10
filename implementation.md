# Knowstr collaboration model implementation plan

This plan implements `idea.md`: ownership in the document decides editability, visibility comes from joined folders/follows, editing foreign documents forks them with lineage, and differences render as suggestions. Phases 0 and 1A are completed groundwork; the draft phases build the collaboration loop on top of it.

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

Phases 1B–5 are ordered to validate the core collaboration loop early, before investing in surrounding polish:

```sh
knowstr join ../shared-space
cp ../shared-space/alice/houses.md . && knowstr save   # fork with lineage
knowstr status --json                                  # suggestions from the three-way diff
```

Local filesystem snapshot storage is pulled forward because forking cannot be correct if Electron/CLI workspaces rely on IndexedDB-only snapshot durability.

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

### Phase 1A.5b — Performance closeout — Parked

Production-relevant regressions are fixed (per-row decode guard, index-based incoming-ref suppression, dead O(N) lookup removal). The remaining residual is test-environment render/event cost, deprioritized in favor of feature work; see `performance-regression.md`.

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

### Phase 1A.6 — Remove remaining `LongID` assumptions — Done

Goal: remove the temporary `LongID` model where it no longer represents a real domain distinction.

Status: **Done**.

Completed:

- Audited all 160 `LongID` references across 27 files: both `ID` and `LongID` were plain `string` aliases, and no call site encoded source state in the type — scoped-ref handling for `basedOn` is specified in Phase 1B.
- Replaced every `LongID` annotation with `ID` and deleted the `LongID` alias from `src/types.ts`.
- `rg "LongID" src` has no hits.
- Verified green with `npm run typescript`, `npm run lint`, and `npm test` (74 suites, 841 tests).

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

## Phase 1B — Node-level lineage and ownership metadata — In progress

Markdown round-trips must carry everything the collaboration model needs at the file level: node-level lineage, hash-shaped snapshot IDs, and document ownership. Do this after Phase 1A so `basedOn` and snapshot lookup use the namespace-scoped ID model.

### Completed checkpoints

1. **Content-addressed snapshot IDs.** `snapshotDTag` renamed to `snapshotId` across all production files; `buildSnapshotEventFromNodes` derives its ID as `snap_sha256_<sha256(content)>` via `snapshotIdForContent` (`src/nodesDocumentEvent.ts`); the mutable `` `snapshot-${docId}` `` ID and its cast are deleted from `src/planner.tsx`. Covered by the fork integration test in `src/editor/DeepCopy.test.tsx` asserting ID shape, hash equality with event content, and the document event referencing the same ID.
2. **Node-level snapshot metadata.** Materialization no longer drops `snapshot` on non-root nodes (`src/core/markdownNodes.ts`); parse and render sides already handled every node. Covered by the parse/render round-trip test in `src/core/Document.test.ts` proving root and child `basedOn`/`snapshot` survive both directions.

### Remaining

- Forks stamp a node-centric `snapshot` on every copied node with `basedOn` (currently root-only), and baseline lookup in `src/core/snapshotBaseline.ts` switches from `rootNode.snapshotId` to the node's own ID — these two must land together.
- `author` frontmatter round-trip and parse-side ownership.
- Malformed snapshot-ID validation in filesystem save paths.
- Non-replaceable snapshot event kind.
- `RootAnchor` provenance audit.

### Decisions to encode

- Rename the internal `snapshotDTag` concept to `snapshotId`. A Nostr snapshot event may use the same value as its `d` tag, but the model concept is a content-addressed snapshot ID.
- Valid snapshot IDs are hash-shaped: `snap_sha256_<64 lowercase hex chars>`.
- `snapshot` is node-level metadata. Preserve, parse, and render it on every node, not just roots.
- Node-level snapshot lookup uses only the node's own `snapshotId`. Do not fall back to root/document snapshot metadata for a node's lineage edge.
- `basedOn` parsing/rendering uses the Phase 1A scoped-ref model for cross-namespace references.
- `RootAnchor` carries a second provenance channel (`sourceAuthor`, `sourceRootID`, `sourceNodeID`, `sourceParentNodeID` — written in `src/core/rootAnchor.ts`, round-tripped through markdown in `src/core/markdownTree.ts`, consumed by `getSnapshotSourceRoot` in `src/planner.tsx` and source resolution in `src/editor/Workspace.tsx`). Audit it against the lineage model: fold the source fields into scoped `basedOn` + node-centric snapshots where they duplicate it, or document precisely which display concern (`snapshotContext` labels) remains anchor state. Two parallel provenance channels must not survive this phase.
- Document ownership is part of the markdown format: `author` persists in frontmatter and survives save/parse/disk round-trips. The internal `Document.author` field exists; the markdown boundary must read and write it. Parsing covers both directions: a file with `author: alice` parses as alice's document, and a file without `author` parses as unowned. Follow the existing `ensureKnowstrDocId` frontmatter pattern in `src/core/Document.ts`.
- Snapshot events must not be replaceable. Today `KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT = 34773` sits in the NIP-33 parameterized-replaceable range, so a snapshot can be silently overwritten by republishing with the same `d` tag (`getReplaceableKey` in `src/nostr.ts`, used by `src/infra/snapshotStore.ts`). Move snapshots to a regular, non-replaceable event kind, carry the content-addressed `snap_sha256_…` ID in a tag, and look snapshots up by that ID. Consumers can verify integrity by hashing the content. The document event (`34772`) stays replaceable — documents are mutable; snapshots are not.
- Preserve `knowstr_vote_id` in frontmatter.
- Whole-document snapshots are sufficient for now. The ID/lookup model should not prevent subtree snapshots later, but this phase does not need to create them.

### Tests first

- Markdown parser/materializer/renderer tests proving `snapshot` survives on child headings, list items, paragraphs, block links, and file links.
- `basedOn` round-trips with scoped refs and local refs.
- `author` frontmatter round-trips through `knowstr save` and a disk readback.
- `knowstr_vote_id` survives save/round-trip.
- Malformed `snapshot` IDs are rejected in filesystem save paths.
- Snapshot baseline lookup uses the node's own `snapshotId` only, with no root fallback.

### Files expected to change (remaining work)

- `src/core/plan.ts` / `src/planner.tsx` — fork/copy paths stamp node-centric `snapshot` on every copied node with `basedOn`.
- `src/core/snapshotBaseline.ts` — baseline lookup uses the node's own `snapshotId`, no root fallback.
- `src/core/Document.ts` — `author` frontmatter read/write next to `ensureKnowstrDocId`.
- `src/infra/filesystem/workspaceScan.ts` (or the markdown parse boundary it uses) — reject malformed snapshot IDs in filesystem save paths.
- `src/nostr.ts`, `src/nodesDocumentEvent.ts`, `src/infra/snapshotStore.ts` — non-replaceable snapshot event kind, store lookup by snapshot ID.
- `src/core/rootAnchor.ts` and its consumers — provenance audit.

### Implementation notes

- Filesystem/CLI parsing should throw clear validation errors for malformed local workspace markdown. Remote/Nostr ingestion should avoid crashing the app on malformed remote documents.

### Acceptance criteria

- `knowstr save` preserves node-level `basedOn`, `snapshot`, `author`, and `knowstr_vote_id` metadata.
- A file with a foreign `author` parses as that author's document; a file without `author` parses as unowned.
- Node-level snapshots are accepted only with `snap_sha256_<64 lowercase hex chars>` IDs; no `snapshot-${docId}`-style mutable IDs remain:

  ```sh
  rg "snapshotDTag|snapshot-\$\{" src
  ```

  has no hits.
- Snapshot diff/baseline lookup for a node uses that node's own snapshot ID and does not inherit from root metadata.
- Snapshot events are published on a non-replaceable kind; no snapshot read or write goes through replaceable-key addressing.
- Existing save/render/navigation behavior remains green.

### Verification

```sh
npm run typescript && npm run lint && npm test
```

Focused suites while debugging:

```sh
npm test -- src/cli/save.test.ts src/core/Document.test.ts
npm test -- src/editor/MarkdownImportPlan.test.tsx src/editor/SuggestionDisplay.test.tsx
```

## Phase 2 — `knowstr join` visibility configuration (draft)

The minimal visibility layer: which folders Knowstr can see other people's documents in.

- Add `.knowstr/spaces.json` for joined folders.
- Add `knowstr join <folder>`, plus list/remove management of joined folders. The CLI today dispatches only `init` and `save` in `src/cli/main.ts`; follow that dispatch/help pattern with a new `src/cli/join.ts`.
- Require an existing `.knowstr`; never create it implicitly. Fail with a clear message pointing to `knowstr init` (today: `.knowstr/profile.json` + `me.nsec`, created by `src/cli/init.ts`).
- Joining never copies, rewrites, normalizes, or deletes anything in the folder. A joined folder keeps whatever structure it has; Knowstr imposes none.
- Exclude joined folders from workspace save scanning and from filesystem watching/write-through claiming. `src/infra/filesystem/workspaceScan.ts` already has the exclusion mechanism (`ALWAYS_IGNORED` + `.knowstrignore` via the `ignore` package); extend it rather than adding a parallel one.
- Ownership of documents inside joined folders is read from their `author` metadata (Phase 1B), not from paths.

UI equivalent: "Shared folders" settings; Follow / open-link / groups are the web instantiations (Phase 9).

## Phase 3 — Local filesystem snapshot storage for Electron/CLI workspaces (draft)

A filesystem workspace must durably store snapshots under `.knowstr/snapshots/`; IndexedDB can remain a cache/browser-only fallback but must not be the only durable store when running in Electron or CLI workspace mode. Pulled forward because forking cannot be correct without durable baselines.

Current state: `src/infra/snapshotStore.ts` is Nostr/IndexedDB-only (snapshot events fetched by author + dTag, cached in `src/infra/nostr/cache/indexedDB.ts`). Nothing filesystem-backed exists.

- Add snapshot storage primitives for initialized filesystem workspaces.
- Store immutable snapshot markdown at `.knowstr/snapshots/<snapshot-id>.md`.
- Use content-addressed IDs: `snap_sha256_<hash>`.
- Add lookup by snapshot ID for CLI and Electron filesystem runtime.
- Keep IndexedDB snapshot storage/caching for browser/Nostr-only mode.
- Snapshot creation is explicit and happens for fork/accept, never for ordinary suggestion computation.
- Snapshot writes are idempotent and never mutate existing snapshot content.
- Electron filesystem mode prefers `.knowstr/snapshots/` over IndexedDB for durable baselines.

## Phase 4 — `knowstr save`: claiming and fork rules (draft)

`save` is the single crossing point from foreign documents into the workspace on the filesystem. Copying a file into your tree is the consent; `save` does the bookkeeping.

Current state: `src/cli/save.ts` has no ownership logic at all — every scanned file is treated as the local user's. The app side already has a related flow: `buildDocumentEvents` in `src/planner.tsx` creates a snapshot when a document's top node has `basedOn` without a snapshot, and a "copy to edit" action exists in `src/editor/Workspace.tsx`. Reuse the same lineage/snapshot primitives rather than building a parallel CLI path.

### Standalone mode (explicit paths, no workspace required)

```sh
knowstr save notes.md
knowstr save docs/a.md docs/b.md
```

- Scans only the explicit files/directories given.
- Assigns missing `knowstr_doc_id` values and missing UUID node IDs.
- Preserves existing `basedOn`, `snapshot`, `author`, and `knowstr_vote_id`.
- Rejects duplicate document IDs and node IDs within the explicit file set.
- Stateless: reads no visibility config, creates no snapshots, never creates `.knowstr`.

### Workspace mode (no paths, requires `.knowstr`)

Per-file behavior is decided by ownership:

- **Own files**: normalized as always — IDs assigned, lineage metadata preserved.
- **Unowned plain markdown** in the workspace: claimed — your ownership stamped along with the IDs.
- **Foreign-authored files** in the workspace: forked — fresh `knowstr_doc_id`, your ownership, minted local node IDs, `basedOn` written for every source node that had an ID, a snapshot of the copied state created through the Phase 3 store, `knowstr_vote_id` preserved.
- **Anything inside a joined folder**: never scanned, claimed, or written.

Forks are never silent. `save` reports every fork it performs:

```text
houses.md: forked from alice (2 nodes linked, snapshot created)
```

Duplicate document/node IDs are rejected across the editable workspace. If a foreign source file has no Knowstr node IDs, the fork still works but carries no node-level lineage.

### Acceptance criteria

- A foreign-authored file copied into the workspace becomes an owned fork with lineage and a durable snapshot after one `knowstr save`.
- The original file in the joined folder is byte-identical before and after.
- Unowned markdown in the workspace is claimed; owned markdown is normalized; joined folders are untouched.
- Fork reports appear in command output.

## Phase 5 — `knowstr status`, `knowstr diff`, `knowstr accept` (draft)

Suggestions as a computed view, with a text/JSON surface for humans and agents and a materialized surface for editor-centric users.

Current state: the three-way diff machinery exists — `computeVersionDiff` in `src/core/snapshotBaseline.ts` drives the version/suggestion rows the app already renders (`getAlternativeFooterData` in `src/semanticProjection.ts`). This phase gives it a CLI surface; it should not reimplement the diff.

### `knowstr status [--json]`

- Reads documents in joined folders, keeps them read-only.
- Computes three-way diffs from lineage: base = the node's `snapshot` baseline, theirs = the origin author's node now, mine = the local node now.
- Prints additions/variants relevant to local documents as suggestions, grouped per document.
- Suppression comes from local graph state and lineage edges only — no run log, no suggestion inbox, no tombstones. Ignored suggestions simply reappear; they disappear when accepted or when upstream reverts.
- Creates no snapshots, mutates nothing.

### `knowstr diff <doc> [--json]`

- Detail view of the suggestions for one document.

### `knowstr accept <ref>`

- Mints a local node ID, writes `basedOn` to the origin node and a node-centric `snapshot` baseline for that lineage edge, and updates the local file.
- Never inserts a foreign node ID into the editable graph.

### `knowstr status --write` — materialization

For users whose interface is their editor:

- Writes suggestions into the user's own files as marked proposal rows. A suggestion row is an ordinary node line with `basedOn` but no `id`, carrying the `(?)` marker — no other markup exists:

  ```md
  - (?) Wooden house <!-- basedOn="a3" -->
  ```

- Only the user's own files are written; joined folders stay untouched.
- The clean file is canonical; materialized markup is a temporary working view.
- `knowstr save` resolves the markup without accept-specific parsing: a row whose `(?)` marker was removed is an ordinary node with `basedOn` and a missing `id`, handled by standard normalization — mint the ID, preserve `basedOn`, create the snapshot baseline for the new lineage edge (the same code path as `accept`). Rows still carrying `(?)` are stripped. Either way the file returns to canonical state.
- A suggestion row is recognized by the combination of the `(?)` marker and `basedOn` metadata; plain text that merely starts with `(?)` is ordinary content.

### Acceptance criteria

- The loop `cp` + `save` → upstream edit → `status` → `accept`/`--write` + `save` works end to end against a joined folder.
- `status` output is stable and `--json` is machine-consumable.
- No source file is ever written; no snapshot is created by `status`/`diff`.

## Phase 6 — Workspace state foundation hardening (draft)

- `knowstr init` creates all required workspace state: `.knowstr/profile.json`, `.knowstr/spaces.json`, `.knowstr/snapshots/`, optional `.knowstr/me.nsec`.
- Shared helpers for requiring an initialized workspace, loading/saving the visibility config, and snapshot path/hash lookup.
- No command except `init` creates `.knowstr`; commands that need workspace state fail clearly when it is missing.

## Phase 7 — Accept convergence across surfaces (draft)

- The UI accept (today in `src/nodeItemMutations.ts`, e.g. `planAcceptDocumentTopIncoming`) and `knowstr accept` converge on the same lineage code path.
- Accepting mints local IDs; foreign node IDs are never inserted as editable local node IDs.
- Every copied node with `basedOn` gets or resolves a node-centric `snapshot` baseline.
- Fork and accept share the same snapshot primitives.

## Phase 8 — `knowstr show` read-only render/export (draft)

- Add `knowstr show <address>`; no such command exists today.
- Support `/d/<author>/<doc-id>` document addresses and `/r/<node-id>` subtree addresses (current app routes).
- Render the visible document/node as portable markdown with enough frontmatter for safe export; reuse `renderDocumentMarkdown` (`src/nodesDocumentEvent.ts` / `src/documentRenderer.ts`); preserve `knowstr_vote_id`.
- Read-only: no save, no fork, no visibility changes, no editable IDs, no `.knowstr`.

## Phase 9 — App visibility and fork-on-write (draft)

The web/Electron instantiation of the same model:

- Visibility: people you follow (contacts exist today), share links you open; groups later.
- Foreign documents render read-only. The first edit shows a lightweight "this creates your copy" affordance and forks — same lineage semantics as `save` (fresh document, minted IDs, `basedOn`, snapshot event/file). The existing "copy to edit" action in `src/editor/Workspace.tsx` is the seed of this flow.
- Suggestions render live as `(?)` overlays wherever lineage relatives differ; no command, no refresh. The overlay rendering exists (`Row.virtualType` rows from `getAlternativeFooterData`); wire it to the lineage three-way diffs.
- App fork/accept paths and CLI paths produce identical metadata, so a document moving between surfaces behaves identically.

## Phase 10 — Regression, cleanup, and docs (draft)

- Full test suite and static checks.
- Update README/CLI help for the collaboration workflows.
- Verify the `idea.md` safety invariants one by one.
- Document explicitly deferred work.

## Future phases

- **Groups** as a first-class visibility scope on Nostr (membership/token management out of scope).
- **Voting aggregates** (`knowstr aggregate`) over `knowstr_vote_id`.
- **Permanent dismissal** of suggestions, if ignoring proves insufficient in practice.
- **Read-only flags** for own folders (consuming your own archive without claiming it).
- **Remove author significance from concrete node identity**: migrate internal `author_uuid` graph IDs to globally unique UUID node IDs once workspace semantics are stable.
