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

## Phase 1A — Namespace-scoped ID foundation (draft)

Split out from the former broad metadata phase. Do this before source/import/suggest so later phases do not bake in author-prefix semantics.

### Decisions to encode

- Concrete markdown node IDs are bare strings. They are not required to be UUID-shaped.
- Generated node IDs should still be UUIDs to avoid accidental collisions, but user-supplied IDs are allowed.
- Local document IDs and local node IDs are user-controlled strings, not required to be UUID-shaped.
- Local IDs must be non-empty, parseable, and safe in markdown HTML-comment attributes.
- The editable local graph must have globally unique node IDs across all local workspace documents.
- Source graphs are read-only candidate graphs. Duplicate node IDs across sources are allowed.
- Remove author/public-key prefixes from concrete node identity. `author_id` / `LongID` should no longer be the core identity model.
- Nostr public keys identify Nostr sources, not node ID namespaces. A followed author is a source containing that author's public documents. Opening `/r/<id>?source=<npub-or-pubkey>` can create/use a temporary source for an author that is not followed.
- Existing `currentAuthor` / `effectiveAuthor` / `pane.author` concepts are source-scope concepts. In the current Nostr implementation a source ID happens to be a public key, but it must be treated as the current lookup source, not as part of node identity.
- Source paths, source registry entries, and Nostr authors are locators/source scopes for lookup. They are not embedded into ordinary node IDs.
- Rename route/query source selection from `author` to `source`; no compatibility alias is required.
- The legacy `_` delimiter and current `splitID` behavior that joins the local part with `:` must be removed for node references. No backwards compatibility is required.
- Source/read-only status comes from the current graph/source context, not from any ID prefix or public key.

### Lookup rules to encode

- A node reference is resolved against a current graph/source scope first.
- If the current scope is local and the ID is not found locally, look in the wider source candidate index.
- If the current scope is not local and the ID is not found in that same source, stop. A source must not implicitly reference local nodes or other sources.
- Local workspace lookup is single-valued because local IDs are unique.
- Source lookup is candidate-valued because duplicate IDs across sources are allowed.
- If a local link falls back to multiple source candidates, choose a deterministic priority target for navigation using registered source order. Ambiguity display/exposing alternate candidates is later UI work, not required in Phase 1A.
- Once a source candidate is selected, traversal of its parent/children/links stays within that candidate's source scope.

### Tests first

- Add markdown round-trip tests showing user-supplied non-UUID IDs are preserved when unique.
- Add validation tests for duplicate node IDs across local workspace documents.
- Add validation tests showing duplicate node IDs across sources are representable as multiple candidates rather than a local workspace error.
- Add resolver tests for:
  - current local scope resolves local first.
  - local scope falls back to source candidates when local is missing.
  - source scope resolves only inside that source.
  - source scope does not fall back to local or other sources.
  - local fallback with multiple source candidates returns priority plus ambiguity metadata.
- Update URL/navigation tests for `/r/<id>?source=<npub-or-pubkey>` temporary-source lookup and remove `?author=` expectations.
- Add migration tests around existing author-named state, proving the current source scope, not an ID prefix, controls lookup.

### Implementation notes

- Introduce explicit graph/source scope types. Suggested vocabulary:
  - `SourceId`: opaque source-scope identifier. For followed Nostr documents this is currently the author's public key; for filesystem sources it can later be a path/registry ID.
  - local graph/source scope: the editable workspace graph.
  - source graph/source scope: a read-only source such as a followed author's public documents, a filesystem source, or a temporary author source.
  - source candidate: a node plus the source/document context required to traverse it safely.
- Migrate the existing author-named lookup plumbing to source terminology: `currentAuthor` / `effectiveAuthor` / `pane.author` should become `currentSource` / `effectiveSource` / `pane.source` where they mean lookup scope. `GraphNode.author` may remain temporarily only as provenance/Nostr-publisher metadata.
- It is acceptable to keep the current author-keyed `KnowledgeDBs` shape during the first iteration if the key is treated as `SourceId` by lookup code. The important migration is semantic: lookups are `getNode(id, currentSource)`, never `getNode(author_id)`.
- Maintain two lookup indexes:
  - `localNodesById` / `localNodeIndex`: single-valued editable local graph index.
  - `sourceCandidatesById` / `sourceNodeIndex`: multi-valued read-only source candidate index.
- Prefer `sourceCandidatesById` in new code when duplicate source IDs can exist.
- Existing `author` fields may remain temporarily only as provenance/Nostr-publisher metadata. New lookup code must not use author as part of node identity.
- Keep markdown output stable for ordinary files: write `<!-- id:<id> -->`, not an author/source-qualified ID.
- Plan the type migration away from `LongID` toward bare `ID`/node ID strings. This may be incremental, but Phase 1A should remove the assumption that `_` means namespace.

### Acceptance criteria

- Node identity no longer depends on author/public-key prefixes.
- Local IDs containing underscores no longer get corrupted by splitting/rejoining.
- User-provided non-UUID document IDs and node IDs are accepted when unique and safe.
- Local workspace duplicate node IDs are rejected clearly.
- Duplicate node IDs across sources are allowed and exposed as source candidates.
- Resolver behavior is current-source-scope-first, with source fallback only from local scope.
- Existing read-only followed-user behavior is preserved by treating followed authors as read-only Nostr sources.
- Source/read-only/editable semantics are determined by graph/source context, not ID shape.

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
