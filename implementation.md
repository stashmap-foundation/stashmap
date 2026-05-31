# Knowstr collaboration model v2 implementation plan

This plan implements `idea.md`. Phase 0 is intentionally removal-only: delete the incompatible legacy ingestion paths before adding the v2 source/import/suggest model.

## Phase 0 — Remove legacy `apply` / `inbox` ingestion

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

## Phase 1 — Metadata v2 compatibility (draft)

Former broad metadata phase. Do this first so source/import/suggest have the right markdown substrate.

- Preserve/parse/render `snapshot` on every node, not just roots.
- Keep `basedOn` parsing/rendering working.
- Preserve `knowstr_vote_id` in frontmatter.
- Add validation for duplicate/malformed document IDs and node IDs.
- Add validation for malformed lineage where practical.
- Prepare code for UUID-like markdown node IDs while keeping current `author_uuid` internals temporarily.
- Avoid making author prefixes carry collaboration semantics.

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
