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

## Phase 1A — Namespace-scoped ID foundation

Goal: source-aware graph identity and lookup. Bare node IDs from markdown/import boundaries must be preserved, duplicate IDs across sources must be represented explicitly, and ordinary planner/domain code must not depend on read-side graph-index internals.

### Required pre-read

Before editing Phase 1A, read the current implementations and representative integration tests that exercise the shared tree/view invariants:

- `src/core/connections.tsx`
- `src/core/nodeFactory.ts`
- `src/graphIndex.ts`
- `src/ViewContext.tsx`
- `src/treeTraversal.ts`
- `src/semanticProjection.ts`
- `src/buildReferenceRow.ts`
- `src/planner.tsx`
- `src/core/plan.ts`
- `src/documentMaterialization.ts`
- `src/documentRenderer.ts`
- `src/navigationUrl.ts`
- `src/editor/TreeEditor.test.tsx`
- `src/PaneContext.test.tsx`
- `src/ViewContext.test.tsx`
- `src/editor/References.test.tsx`
- `src/editor/IncomingRefInteraction.test.tsx`
- `src/desktop/FilesystemWriteThrough.test.tsx`

### Checkpoint discipline

Phase 1A must be implemented in small checkpoints. A checkpoint is one narrow change or one subsystem migration, not a broad batch of related edits.

Before the first edit and after every checkpoint, run:

```sh
npm run typescript
npm run lint
npm test
```

Do not use `--runInBand` for normal verification. The full test suite is expected to be cheap enough to run at every checkpoint. Focused tests may be run while debugging, but they do not replace the full-suite checkpoint gate.

Do not continue to the next checkpoint while any of these commands are red. If the suite fails broadly after a checkpoint, stop and fix the shared invariant or revert that checkpoint before continuing. Do not patch individual failing tests around a broken central behavior.

Stop immediately if editor/tree tests show merged labels or lost row focus, e.g. output like `SpainBali`, `ldRoot`, `InfotcoinCrypto`, or any case where typing `Enter`/`Tab` continues in the previous row instead of creating/focusing the expected row. That indicates a broken shared tree/view invariant, not a test expectation problem.

### Non-negotiable compatibility constraints

- Keep existing UI/editor/tree behavior green at every checkpoint.
- Do not remove author-prefixed/global generated IDs before source-aware lookup is centralized and all relevant boundaries carry source explicitly.
- Do not change generated UI node ID shape, `joinID`, `shortID`, `splitID`, view-path semantics, or row-focus behavior in the same checkpoint as a lookup migration.
- Preserve safe bare IDs from markdown/import boundaries. Generated node IDs should still be UUID-based to avoid accidental local collisions; they may remain in the existing legacy-compatible generated form until all boundary types carry `sourceId` explicitly and the full suite is green.
- Do not make `GraphNode.author` mean lookup source. `GraphNode.author` is provenance/publisher; `NodeRef.sourceId` is lookup scope.
- Do not expose `graphIndex.nodesBySource`, `graphIndex.sourceCandidatesById`, or `graphIndex.nodeByID` to ordinary callsites.
- Do not export low-level resolver APIs that force callsites to construct ad hoc resolver/env objects. Use small pure domain functions.
- Do not let planner code use graph-index-backed lookup. Planner mutates `knowledgeDBs`; `graphIndex` can be stale during a plan.

### Decisions to encode

- Concrete markdown node IDs are bare strings and are not required to be UUID-shaped.
- Generated node IDs should still be UUID-based to avoid accidental local collisions.
- Local document IDs and local node IDs are user-controlled strings when safe and unique.
- Local IDs must be non-empty, parseable, and safe in markdown HTML-comment attributes.
- The editable local graph must have globally unique node IDs across local workspace documents.
- Source graphs are read-only candidate graphs. Duplicate node IDs across different sources are allowed.
- Source/read-only/editable semantics come from graph/source context, not ID shape.
- Routes use `/r/<id>?source=<source-id>`; remove `?author=` compatibility.
- Plan the migration away from `LongID`; keep it only temporarily where needed.

### Core lookup rules

Centralize exactly these rules:

1. Resolve an ID in the current source first.
2. If not found and the current source is local, try source candidates in deterministic source order.
3. If the current source is non-local, stop. A source must not implicitly reference local nodes or other sources.
4. Once a source candidate is selected, parent/child/link traversal stays in that selected source.

### Functional read model

Add a functional read-side module, e.g. `src/core/graphLookup.ts`. Do not use methods/OOP.

```ts
type NodeRef = { sourceId: SourceId; id: ID };
type ResolvedNode = { ref: NodeRef; node: GraphNode };

type GraphLookup = {
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
  localSourceId: SourceId;
  sourceOrder: readonly SourceId[];
};
```

Export only domain-level pure functions:

```ts
graphLookupFromData(data: Data): GraphLookup;
getNodeInSource(graph: GraphLookup, ref: NodeRef): ResolvedNode | undefined;
lookupNode(graph: GraphLookup, id: ID, currentSourceId: SourceId): ResolvedNode | undefined;
resolveBlockLinkTarget(graph: GraphLookup, source: ResolvedNode): ResolvedNode | undefined;
parentOf(graph: GraphLookup, node: ResolvedNode): ResolvedNode | undefined;
childrenOf(graph: GraphLookup, node: ResolvedNode): ResolvedNode[];
resolveReferenceForView(graph: GraphLookup, panes: Pane[], viewPath: ViewPath, refId: ID): ResolvedReference | undefined;
```

Callsites should look like this:

```ts
const graph = graphLookupFromData(data);
const sourceItem = lookupNode(graph, refId, paneSourceId);
const target = sourceItem ? resolveBlockLinkTarget(graph, sourceItem) : undefined;
```

They must not construct inline resolver env objects and must not read graph-index internals.

### Planner-safe lookup

Add a separate planner-safe module, e.g. `src/core/planLookup.ts`, that never imports or reads `graphIndex`.

- Planner lookup is exact source lookup from `knowledgeDBs` only.
- Planner functions should receive already-resolved `NodeRef`/`ResolvedNode` from the read side when needed.
- Planner functions must not perform source-candidate fallback while mutating a plan.

### Lint rules first

As the first implementation checkpoint, add lint restrictions:

- In `src/planner.tsx` and `src/core/plan.ts`, ban imports of graph lookup modules that use `graphIndex`, ban imports of `graphIndex`, and ban `*.graphIndex` member access.
- Outside `src/core/graphLookup.ts`, `src/graphIndex.ts`, and tests, ban direct reads of:
  - `graphIndex.nodeByID`
  - `graphIndex.nodesBySource`
  - `graphIndex.sourceCandidatesById`
- After migrating callsites, ban `sourceCandidatesById.get(...)?[0]`-style first-candidate guessing everywhere except inside `graphLookup.ts`.

Run the full checkpoint verification after adding the lint rules before continuing.

### Implementation checkpoints

Run the full checkpoint verification after each numbered item below. For items that name multiple subsystems, migrate one subsystem at a time and run the full checkpoint verification after each subsystem.

1. Add lint restrictions above.
2. Add `NodeRef`, `ResolvedNode`, ID normalization helpers, and pure `graphLookup.ts` while old IDs still work. Do not migrate UI callsites or change generated ID shape in this checkpoint.
3. Add graph lookup unit tests for the core lookup rules and ambiguity behavior.
4. Update `graphIndex` internals/APIs to index by explicit `sourceId` when indexing source documents. Keep legacy compatibility fields internal; do not infer lookup source from `GraphNode.author` when an explicit source is available.
5. Add tests proving `graphIndex` indexes nodes under explicit `sourceId`, not `GraphNode.author`, and allows duplicate IDs across different sources.
6. Migrate read/rendering callsites to `graphLookup.ts` helpers before changing concrete ID shape. Suggested order, each as its own checkpoint:
   - `ViewContext` and `treeTraversal`;
   - `buildReferenceRow` and reference-row rendering;
   - `semanticProjection`, incoming refs, suggestions, versions, search, and virtual rows;
   - breadcrumbs/navigation helpers that read current nodes.
7. Update boundary/view types to carry source explicitly where a bare ID crosses layers. Suggested order, each as its own checkpoint:
   - `Pane` root/source state;
   - `ReferenceRow` / referenced-by / incoming/version refs;
   - virtual rows;
   - route parsing/building and navigation URLs.
8. Update markdown parsing/materialization/rendering so safe explicit markdown IDs remain bare and local duplicate IDs across workspace documents are rejected. Do not change generated UI node ID behavior in the same checkpoint.
9. Switch routes to `/r/<id>?source=<source-id>` and remove `?author=` compatibility as its own checkpoint.
10. Only after all callsites carry source explicitly and the full suite is green, consider removing remaining author/public-key prefixes from concrete node identity. Prefer deleting `joinID`/`shortID` callsites over turning those functions into semantic no-ops. If legacy splitting remains necessary for compatibility, leave it isolated and document the remaining migration work.
11. Remove remaining `LongID` assumptions incrementally, with tests, only in separate green checkpoints.

### Tests first

Add or update tests before each behavior change where practical:

- Unit tests for `graphLookup.ts`:
  - current source resolves first;
  - local scope falls back to source candidates;
  - non-local source scope does not fall back;
  - duplicate source candidates are deterministic and expose ambiguity;
  - parent/child/link traversal stays in the selected source.
- Tests proving `graphIndex` indexes nodes under an explicit `sourceId`, not `GraphNode.author`.
- Markdown round-trip tests preserving safe user-supplied non-UUID IDs.
- Validation tests rejecting duplicate local node IDs across workspace documents.
- Tests allowing duplicate IDs across sources as separate candidates.
- URL/navigation tests for `/r/<id>?source=<source-id>` and removal of `?author=`.
- Integration tests for reference rows, incoming refs, suggestions, versions, search rows, breadcrumbs, and editor tree behavior with duplicate source IDs.
- Lint verification that planner code cannot read or import `graphIndex`/graph-index-backed lookup.

### Acceptance criteria

- `npm run typescript`, `npm run lint`, and `npm test` pass without `--runInBand`.
- Existing editor/tree typing, Enter/Tab insertion, row focus, breadcrumbs, and pane behavior remain green.
- Ordinary UI/rendering code never reads graph-index internals directly.
- Planner code has no access to `graphIndex` or graph-index-backed lookup.
- Lookup behavior is implemented once in functional helpers and matches the four core lookup rules.
- Source identity is carried as `NodeRef.sourceId`, not inferred from `GraphNode.author`.
- Bare IDs in markdown are preserved, and local IDs with underscores are not corrupted.
- Duplicate IDs across sources are represented as candidates, not collapsed into one `nodeByID` value at callsites.
- Existing read-only followed-user behavior still works by treating followed authors as source scopes.

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
