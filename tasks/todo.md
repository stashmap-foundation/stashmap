# Unified storage-backend plan

## Goal

Collapse the product onto one collaboration model: inbox/merge with stable node UUIDs.

Only backend differences should remain:

- filesystem storage
- Nostr storage

The current frontend follow/deep-copy multi-user mechanic is out of direction and should be removed rather than preserved.

## Decision

- Kill frontend multi-user product semantics for now.
- Make the CLI inbox/apply model the canonical collaboration model.
- Reuse the existing editor/planner/UI where possible.
- Build one desktop app that can eventually run on two storage backends.
- Start with an Electron wrapper around the existing Nostr-backed app.
- Add the filesystem backend after Electron is working.

## Tests

### Phase 1: Electron wrapper with Nostr backend

- [ ] Add an Electron bootstrap smoke test or minimal verification step for main/preload startup if test tooling is introduced.
- [x] Add an integration smoke test or manual verification checklist that the app still logs in, loads relays, edits, publishes, and can create a new account in the Electron shell.
- [x] Run targeted jest tests for any extracted Electron-specific code.
- [x] Run `npm run typescript`.
- [x] Run `npm run lint`.

### Phase 2: Unified backend boundary + filesystem backend

- [ ] Add a backend-agnostic document-store test that loads canonical document content into the app graph without relying on follow-based visibility.
- [ ] Add a filesystem backend test that loads a temp workspace with real markdown files and materializes the expected tree.
- [ ] Add a filesystem backend write test that edits a node through the planner, persists to disk, and preserves existing node ids.
- [ ] Add a filesystem backend write test for creating a new root and writing it to a deterministic new file.
- [ ] Add a filesystem backend write test for deleting a root and applying the chosen file policy.
- [ ] Add a filesystem backend refresh test where an external file change is reflected in the app graph.
- [ ] Add an integration UI test that renders the app in filesystem mode, types to create/edit/reorder content, and verifies the resulting markdown on disk.
- [ ] Add an integration UI test that relay/follow-specific affordances are absent in the unified single-user/inbox app.
- [ ] Run targeted jest tests for the new backend boundary and filesystem mode.
- [ ] Run `npm run typescript`.
- [ ] Run `npm run lint`.

## Implementation

### Phase 1: Electron wrapper with current Nostr backend

- [x] Add Electron app scaffolding.
- [x] Decide minimal Electron shape:
  - [x] main process
  - [x] preload
  - [x] renderer hosting the existing React app
- [x] Keep the first desktop UX identical to the current Nostr app.
- [x] Make sure login, relay access, edit, and publish flows work in Electron.
- [x] Restore desktop account creation flow so Electron users can generate a new nsec/private key without extension login.
- [x] Keep knowstr.com unchanged.

### Phase 2: Unified app semantics

- [ ] Extract a backend boundary from `Data.tsx` and `PlanningContextProvider` so the editor no longer assumes the current Nostr follow model.
- [ ] Keep deployment UX simple: do not add a generic workspace/source chooser to knowstr.com unless the web surface truly supports multiple sources.
- [ ] Remove or gate legacy follow/multi-user UI flows that are specific to the old frontend model.
- [ ] Make the core app model single-user + inbox/merge, independent of storage backend.

### Phase 3: Filesystem backend in Electron

- [ ] Add a filesystem backend:
  - [ ] load `.knowstr/profile.json`
  - [ ] scan workspace documents via the existing workspace pipeline
  - [ ] materialize them into the document store
  - [ ] maintain a root/file ownership index
  - [ ] persist affected roots back to disk
  - [ ] support explicit refresh
- [ ] Decide the filesystem root file policy:
  - [ ] new root -> deterministic new file path
  - [ ] deleted root -> remove or archive file
- [ ] Keep `knowstr save` and `knowstr apply` as the canonical normalization/inbox operations and wire them into the filesystem backend as needed.
- [ ] After filesystem mode works, reshape the Nostr backend so it uses the same inbox/merge semantics instead of the old follow/deep-copy semantics.

## Open questions

- [ ] Exact backend interface shape.
- [ ] Exact Electron packaging/build setup.
- [ ] Save model: autosave, explicit save, or hybrid.
- [ ] New-root file naming policy.
- [ ] Delete policy: delete file vs archive.
- [ ] How Nostr should represent inbox/raw/merged state while staying semantically aligned with the filesystem model.

## Review

- [x] Architecture updated in `tasks/architecture.md`.
- [x] Plan reflects the new product decision: one collaboration model, two storage backends.
- [ ] Implementation verified with real temp-workspace tests, not mocked contexts.
- [x] Electron scaffolding added under `electron/` with desktop build/dev scripts.
- [x] Desktop renderer now switches to `HashRouter` in Electron and hides extension-only sign-in.
- [x] Verified with:
  - [x] `npm test -- --runInBand src/runtimeEnvironment.test.ts src/SignIn.test.tsx`
  - [x] `npm test -- --runInBand src/SignIn.test.tsx src/SignUp.test.tsx src/runtimeEnvironment.test.ts`
  - [x] `npm run typescript`
  - [x] `npm run lint`
  - [x] `npm run desktop:build`
  - [x] Manual Electron smoke pass confirmed by user: app opens, Electron works, and core flow looks good
