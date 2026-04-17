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

### Phase 2 — Step 1: Introduce `BackendContext` + `NostrBackendProvider`

**Scope:** Stand up the new context/provider seam without changing any existing callers. After this step, all current behavior is identical; we just have a new provider in the tree that exposes the same capabilities via a new API surface, ready for callers to migrate in step 2.

**Design (short-term shape per architecture.md):**

New file `src/BackendContext.tsx`:
- `type Backend = { subscribe, publish }` where:
  - `subscribe(relays: Relay[], filters: Filter[], callbacks: { onevent, oneose }) => { close: () => void }` — thin wrapper over `relayPool.subscribeMany`
  - `publish(relays: Relay[], event: Event) => Promise<string[]>` — wraps `relayPool.publish` collecting per-relay results
- `BackendContext = React.createContext<Backend | undefined>(undefined)`
- `useBackend(): Backend` hook that throws if not provided (mirrors `useApis` convention from `Apis.tsx:25`)
- `BackendProvider({ backend, children })` is a pass-through

New file `src/NostrBackendProvider.tsx`:
- Consumes `useApis()` internally to get `relayPool` and `finalizeEvent`
- Builds the `Backend` object that wraps those
- Wraps children in `BackendProvider`
- Mounts inside `NostrProvider` in `src/index.tsx` so it has access to the `Apis` context

Provider tree after this step (`src/index.tsx`):
```
NostrProvider
  NostrBackendProvider        ← NEW
    NostrAuthContextProvider
      UserRelayContextProvider
        App
```

**Tests (before implementation):**

- [x] `src/BackendContext.test.tsx`: `useBackend` throws with a clear error when no provider is in the tree (mirrors the error shape of `useApis`). One test, minimal.
- [x] `src/NostrBackendProvider.test.tsx`: integration-style — mount a tiny test component inside `NostrProvider` + `NostrBackendProvider`, assert `useBackend()` returns an object with `subscribe` and `publish` functions. No real relay traffic; just verifies wiring.
- [x] Full existing suite must still pass unchanged (`npm test`, `npm run typescript`, `npm run lint`). This is the real verification that step 1 is non-invasive.

**Implementation:**

- [x] Write failing tests for `BackendContext` and `NostrBackendProvider`.
- [x] Create `src/BackendContext.tsx` with `Backend` type, `BackendContext`, `useBackend`, `BackendProvider`.
- [x] Create `src/NostrBackendProvider.tsx` that reads `useApis()` and wraps `relayPool.subscribeMany` / `relayPool.publish` into the `Backend` shape.
- [x] Mount `NostrBackendProvider` in `src/index.tsx` between `NostrProvider` and `NostrAuthContextProvider`.
- [x] Run `npm test -- --runInBand src/BackendContext.test.tsx src/NostrBackendProvider.test.tsx`.
- [x] Run `npm run typescript`.
- [x] Run `npm run lint`.
- [x] Run full test suite to confirm no regressions (62 suites, 729 tests pass).

**Non-goals for this step (deferred to later steps):**

- Not migrating `useEventQuery` callers.
- Not touching `planner.execute()`.
- Not replacing `useApis().relayPool` anywhere.
- Not designing the target document-centric shape — that's after filesystem backend exists.

---

### Phase 2 — Step 2: Migrate `useEventQuery` callers to `useBackend()`

**Scope:** `useEventQuery` is the last Nostr-specific subscription surface in the renderer. Swap its parameter from `SimplePool` to `Backend`, then update every call site to pass `useBackend()` instead of `useApis().relayPool`. Behavior is identical since `Backend.subscribe` is a direct passthrough to `relayPool.subscribeMany`.

**Callers to migrate** (found via `rg useEventQuery`):
- `src/commons/useNostrQuery.tsx:33` — signature change
- `src/UserRelayContext.tsx:34` — drop `useApis().relayPool`, use `useBackend()`
- `src/Data.tsx:305, 343` — drop `useApis().relayPool` (line 247), use `useBackend()`
- `src/components/SearchModal.tsx:63` — drop `useApis().relayPool` (line 36), use `useBackend()`

**Test harness update:**
- `src/utils.test.tsx` — wrap children in `NostrBackendProvider` inside `ApiProvider` so `useBackend()` resolves in tests. This is the one place all integration tests mount the provider stack.

**Tests:**
- [x] Full existing suite must still pass unchanged — since behavior is identical, this is the verification. No new tests needed (`useEventQuery` has no direct test today; integration tests exercise it via `UserRelayContext`, `Data`, `SearchModal`).

**Implementation:**
- [x] Change `useEventQuery` signature: `relayPool: SimplePool` → `backend: Backend`; body: `relayPool.subscribeMany` → `backend.subscribe`.
- [x] Migrate `UserRelayContext.tsx`.
- [x] Migrate `Data.tsx` (two call sites, one `useApis` declaration to swap).
- [x] Migrate `SearchModal.tsx`.
- [x] Update `src/utils.test.tsx` harness to include `NostrBackendProvider`.
- [x] Run `npm run typescript`.
- [x] Run `npm run lint`.
- [x] Run full test suite (62 suites, 729 tests pass).

---

### Phase 2 — Step 3: Migrate publish path to `useBackend()`

**Scope:** `relayPool.publish` is the last Nostr-specific dependency in the planner/executor/publish-queue. Swap it to `Backend.publish` so the planner becomes backend-agnostic. `Backend.publish` has the exact same signature as `SimplePool.publish`, so this is mechanical.

**Type change:**
- `Pick<SimplePool, "publish">` → `Pick<Backend, "publish">` (same structural shape).

**Call-site migrations:**
- `src/nostrPublish.ts` — `publishEventToRelays(relayPool, ...)` → `publishEventToRelays(backend, ...)`.
- `src/executor.tsx` — `execute({plan, relayPool, finalizeEvent})` → `execute({plan, backend, finalizeEvent})`; same for `republishEvents`.
- `src/PublishQueue.ts` — `FlushDeps.relayPool` → `FlushDeps.backend`; internal `publishToRelays` helper.
- `src/planner.tsx` — `useApis()` no longer destructures `relayPool`; pull `backend` from `useBackend()`. Pass through to `depsRef`, `execute`, `republishEvents`.
- `src/SignIn.tsx:189, 238` — drop `relayPool` from `useApis()` destructure, add `useBackend()`.
- `src/StorePreLoginContext.tsx:29, 42` — same.

**Test harness:**
- `src/utils.test.tsx:applyApis` — add `backend` to `TestApis` derived from `relayPool` so test spreads `{ ...utils, plan }` work.
- `src/PublishQueue.test.ts` — update `getDeps` FlushDeps from `relayPool: ...` to `backend: ...`.

**Tests:** Full existing suite passes (behavior is identical; publish surface is structurally the same). No new tests needed.

**Implementation:**
- [x] Update `nostrPublish.ts`.
- [x] Update `executor.tsx`.
- [x] Update `PublishQueue.ts`.
- [x] Update `planner.tsx`.
- [x] Update `SignIn.tsx`.
- [x] Update `StorePreLoginContext.tsx`.
- [x] Update `utils.test.tsx` harness (add `backend` to `TestApis`).
- [x] Update `PublishQueue.test.ts` getDeps.
- [x] Run `npm run typescript`.
- [x] Run `npm run lint`.
- [x] Run full test suite (62 suites, 729 tests pass).

**After step 3**, the renderer no longer references `relayPool` except inside `NostrBackendProvider`. The seam is complete; step 4 can begin on the filesystem backend.

---

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
