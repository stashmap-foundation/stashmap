# Knowstr collaboration model implementation plan

This plan implements `idea.md` — read it first, especially the suggestion lifecycle: **materialization is the only engine transition; "accept" is not an operation**. The workspace is the only thing Knowstr writes; copies keep their IDs so relatedness is observable anywhere; `diff <address>` correlates and attributes drift using lazy content-addressed baselines; everything after materialization is ordinary editing of ordinary nodes.

Completed groundwork (Phase 0 inbox removal, Phase 1A namespace-scoped IDs, Phase 1B lineage checkpoints) is archived in `implementation/done.md`.

Conventions: **Done** means committed and verified with `npm run typescript && npm run lint && npm test` (no `--runInBand`). Work in small green checkpoints. `(draft)` phases are scope/order placeholders; before starting one, expand it with tests-first steps, exact files/functions, acceptance criteria, and verification commands.

## Part 1 — Align the codebase with idea.md

A codebase audit (2026-06-11) found the surfaces below contradicting the model. Eliminating these discrepancies comes before any new feature: the multi-user machinery is built on two retired primitives — author-as-boundary and text-equality-as-identity — and is **deleted, not migrated**. The app becomes a clean single-user editor on all three runtimes (CLI, Electron, web), then collaboration is rebuilt on the source boundary.

### Phase A1 — Demolition: remove multi-user machinery on retired primitives — Done

Completed 2026-06-12 (commits `1d268ab`..`94d5240`, +684/−2723). The detailed execution prompt with checkpoints, dependency map, prohibited compatibility moves, and hard-grep gates lives in **`implementation/03-demolition.md`**. Summary:

Remove, in checkpoint order:

1. **`RootAnchor`, entirely**: its source fields duplicate `basedOn` (the deep-copy flow writes both from the same source node, `core/plan.ts:456-467`), and its frozen breadcrumb (`snapshotContext`/`snapshotLabels`, serialized as `anchorContext=`/`anchorLabels=`) is a third file vocabulary `idea.md` forbids. Fold the one real consumer first — `getSnapshotSourceRoot` (`src/planner.tsx:711`) re-derives the snapshot source from `basedOn` + node-centric snapshots — then delete the type, `GraphNode.anchor`, factory, markdown round-trip, file format, and breadcrumb rendering. Closes the 1B "second provenance channel" item by full deletion; the stale came-from breadcrumb is lost (re-derivable live from `basedOn` later if missed).
2. **Dead vocabulary**: the `hidden` attribute end to end (no production writer; silently deletes user rows on save); the orphaned `nodesMatchForVersion`.
3. **Suggestion/version producer — cut, don't kill**: the `[V]` "+x/−y" version rows and `(?)` suggestion rows are lineage-driven (`getVersions` walks `basedOn` chains and the `basedOnIndex`) and work single-user — a fork is a version of its original — so the feature **stays**. Deleted: the text-equality suppression inside `getAlternativeFooterData` (suppression becomes `originKey`-only; same text with different origin is no longer suppressed) and the contacts-derived `visibleAuthors` input. Multi-user test fixtures are replaced by self-fork coverage on the DeepCopy flow.
4. **Follow/contacts** — "follow" in this codebase *is* the NIP-02 contact list: follow/unfollow UI (`Node.tsx`, `RightMenu.tsx`), `planAddContacts`/`planRemoveContact`/`planUpsertContact`/`newContactListEvent`, `src/contacts.ts`, `KIND_CONTACTLIST` subscription, the `Contact`/`Contacts`/`FollowList` types, `Data.contacts`/`Data.contactsRelays` and all consumers.
5. **User entries**: `src/infra/nostr/userEntry.ts`, `GraphNode.userPublicKey` including its file-format serialization.
6. **Cross-author sync and contact relays**: `buildPermanentSyncAuthors`, `useContactsRelays`, `ContactRelaysDisplay`. Sync authors become own author **plus pane authors** — the `extraAuthors` ad-hoc path is keep-list: it is what loads a foreign link read-only (the web's address-loader seed for B6), and it works logged-out. `UserRelayContext` (own relay config) stays.
7. **Pre-login editing**: `StorePreLoginContext`, the planner key-upgrade path. Logged-out web becomes a read-only viewer; `UNAUTHENTICATED_USER_PK` shrinks to a session sentinel that never appears on plans, events, or nodes (finished off by `LOCAL` in A2).

Keep — looks multi-user, is not (breaking these fails the phase):

- **Fork/lineage machinery**: `basedOn`, node snapshots, `DeepCopy`, `computeVersionDiff` — the diff engine's foundation; `DeepCopy.test.tsx` stays green throughout.
- **Incoming refs and search**, including the **semantic-ID substrate** (`getSemanticID`/`getNodeSemanticID`/`isEmptySemanticID`, semantic contexts): it serves search, incoming refs, context chains, and empty-row checks — single-user editor internals, explicitly out of A1's scope. Only the *suggestion-suppression* use of text identity dies here; after demolition no text matching crosses a user boundary. Revisit with B6.
- Web login/identity (the workspace container on web), own-author sync, all editor behavior, the 1A `SourceId`/`graphLookup` machinery (its contact-fed source-candidate list becomes empty; re-fed by loaders in B1).

Acceptance: the hard greps in `implementation/03-demolition.md` are clean; keep-list tests green; logged-out web is read-only; net diff strongly negative; full gate green.

### Phase A2 — The source boundary

The detailed execution prompt with the full model, checkpoints, prohibited moves, and hard acceptance criteria lives in **`implementation/04-source-boundary.md`**. Summary:

The boundary is "which source a node was loaded into", never "which author". Exactly one source is writable, and the engine names it relatively:

- **`LOCAL` is relative, addresses are absolute** — like `~` vs `/home/alice`. `LOCAL: SourceId = "local"` (one constant, `src/core/nodeRef.ts`, identical literal on all runtimes) keys the workspace inside the engine; URLs, files, and events always carry absolute addresses. Two session-aware pure functions in `src/navigationUrl.ts` translate at the boundary and nowhere else: `resolveAddress(address, session)` (inbound; on web, any spelling of the session's own npub canonicalizes to `LOCAL`) and `addressForSource(sourceId, session)` (outbound; `LOCAL` → own npub on web, `undefined` on keyless desktop until `share`).
- **The web address bar is always absolute** — copying the URL *is* sharing. The same URL resolves per viewer: editable workspace for its owner, read-only foreign source for everyone else (and for logged-out viewers). Own-npub → `LOCAL` is a web-only resolver rule; on desktop your own npub later resolves to a *foreign deposit* (diff reports ok/stale) because the workspace lives in the directory, not the key.
- `KnowledgeDBs` keyed by `SourceId`; `documentKeyOf(sourceId, docId)`; **`GraphNode.author` deleted** — a node is content + lineage; where it lives is the map key, carried by `NodeRef`. The signing pubkey enters at the publish boundary as a parameter; the npub exists only there.
- **Writes unrepresentable, not guarded**: planner/mutation functions take plain `ID` (always `LOCAL`); the plan carries only the local graph; the five author guards are deleted without replacement — a foreign ref no longer typechecks as a mutation target. The UI discriminates in one place: `row.ref.sourceId === LOCAL` picks edit verbs vs boundary-crossing verbs.
- `Pane.author` deleted; `UNAUTHENTICATED_USER_PK` deleted (logged-out = absent key, empty `LOCAL`, no edit affordances — the viewer falls out with zero special-casing).
- Electron writes files only: desktop edits construct no Nostr events.

Acceptance (hard criteria in the prompt): same-URL-three-viewers test (owner edits, others read-only, logged-out reads-only); resolve/address round-trip canonical; opening your own shared URL creates no second source; mutations modules contain no `LOCAL` checks; `rg "\.author\b" src` and `rg "UNAUTHENTICATED_USER_PK" src` clean; Electron edits produce zero events; full gate green.

### Phase A3 — Phase 1B closeout (remaining items)

Status: **Done** (commits 0078a5c..feda75d + vote-id coverage).

- Malformed snapshot-ID validation in filesystem save paths: node-level snapshots accepted only with `snap_sha256_<64 lowercase hex>` IDs; clear errors for workspace markdown, no crashes on malformed foreign documents.
- `knowstr_vote_id` round-trip regression coverage.
- Duplicate node-ID rejection reports file paths and guidance per `idea.md` (currently a bare single-ID throw at `src/core/markdownNodes.ts:44`), and collects all duplicates instead of aborting on the first.

## Part 2 — The nucleus (drafts)

```sh
cp ~/Dropbox/team/holidays.md . && knowstr save   # born relation: IDs travel with the copy
knowstr diff ~/Dropbox/team --write               # baselines + (?) rows in the files
vim holidays.md && knowstr save                   # re-rank or delete; save settles lineage either way
```

### Phase B1 — Read-only address loader (draft)

The one genuinely new module; prerequisite for everything below. A pure function from `{path, content}` files to read-only source graphs.

- One source per file, `sourceId` = the file path (the 1A per-file-namespace sense).
- The workspace parser minus its write-side behaviors: no ID minting, no uniqueness enforcement, nodes without IDs skipped, never persisted.
- Shared verbatim by CLI and Electron main (both run in Node).

### Phase B2 — Global content-addressed snapshot store (draft)

- One store per machine at `~/.knowstr/snapshots/<snap_sha256_…>`, shared by CLI and Electron; created on first write; write-once by hash, idempotent, never mutated. IndexedDB remains a cache for the web runtime.
- Loss is recoverable by design: a missing snapshot re-baselines on next `diff`.
- Move the snapshot event kind off the NIP-33 replaceable range (`KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT = 34773` today): replaceable events can silently swap a baseline — this is foundation work, not share-layer cleanup. Validate hash-vs-content when reading snapshot events.
- Fix the web baseline path: `NostrDataProvider` hardcodes `snapshotNodes` empty while `permanentSync` subscribes to snapshot events that never reach the UI.

### Phase B3 — `knowstr diff <address>` (draft)

The product. Reuses `computeVersionDiff` (`src/core/snapshotBaseline.ts`).

- Address is a file or folder (links come with `show`/`share`). Reads the address read-only; never writes the workspace except `--write`; stateless.
- Correlation by node IDs and `basedOn` only, **per node**: one foreign file may relate to several workspace documents.
- Three buckets per foreign document: your deposit (ok/stale via content identity, never timestamps), shared-lineage-diverged (suggestions), unrelated.
- Rules per `idea.md`: per-file namespaces, mirror detection, cross-sibling dedupe, nearest-shared-ancestor anchoring, folder addresses summarize unrelated documents / single-file addresses always named.
- Report format per `idea.md`; `--json` for agents.

Acceptance: the `idea.md` walkthrough end to end against a folder, including late healing.

**Re-coverage manifest** — behaviors whose tests were deleted in A1 because their data path (contacts) died; each must be re-pinned here or in B6 once foreign sources load through this engine:

- removing a source removes its cached suggestions (was: "unfollowing removes cached suggestions from that user")
- incoming refs from a foreign source render with a foreign marker (was `[OI]`)
- accepting a foreign incoming ref creates a bidirectional link
- declining a foreign incoming ref hides it
- the same incoming ref offered by several sources is deduplicated to one row
- search results include loaded foreign sources, marked as foreign, with context paths that never show a loading placeholder
- incoming refs resolve bare ids across sources (cross-source ref targeting)

### Phase B4 — `--write` bulk materializer (draft)

- Materializes every suggestion into workspace files as `(?)` rows carrying provenance: `- (?) Montenegro <!-- basedOn="a5" -->`. Only workspace files are written.
- `save` needs **zero new code**: a materialized row is an ordinary node with `basedOn` and a missing ID — existing normalization mints the ID, keeps `basedOn`, baselines the edge; the `(?)` prefix is the existing `maybe_relevant` relevance marker (`RELEVANCE_CHARS`, `src/core/markdownTree.ts`). There is no marker resolution, stripping, or accept-specific parsing anywhere.

### Phase B5 — `knowstr show <address>` (draft)

- Read-only render to stdout; reuse `renderDocumentMarkdown`. Preserve `knowstr_vote_id`.
- Fetch use: `show <link> > file` stores the content-addressed snapshot as a side effect; with the `share` layer, fetched files carry `track:` so the next `save` settles them into clean `basedOn` forks with that baseline.

### Phase B6 — App wiring (draft)

Drop = `diff`, take = `--write`. No new UI components — split panes, overlay rows, and the relevance selector already exist.

- Dropping a file/folder (Electron; web reads the file in memory) runs the diff engine: folder summary view with per-document rows and one "take all as `(?)`" bulk action; click-through opens your document (editable, `(?)` overlay rows in place, attributed) beside the foreign document (read-only pane). Closing forgets; nothing is written by the drop itself.
- One new behavior: **interacting with a virtual row materializes it first** — setting a relevance (= "take as…"), editing its text, or dragging it each create the ordinary node-with-`basedOn`, then proceed. All existing controls then work on suggestions for free.
- Unrelated documents: one "add to workspace" action — settle at the door (fresh IDs, `basedOn` per node, baseline from the dropped bytes). This replaces the current `FileDropZone`/`MarkdownUpload` silent ingestion, which is the Phase 0 inbox problem in another door.
- Web: opening or pasting a link is `diff <address>` against that namespace. Logged out, the web app is a read-only viewer; landing on knowstr.com with no address offers one-click onboarding — generate a key, copy it to the clipboard, log in — so a new visitor is typing immediately. The click itself must make storing the key non-optional knowledge: the copied key is the account, there is no recovery.
- Overlay rendering is fed by the diff engine. The suggestion/version producer survived demolition as a live single-user feature (self-variants via `basedOn` lineage, `[V]` counts, `(?)` rows — see A1 checkpoint 3), and the virtual-row machine is shared with incoming refs — B6 feeds foreign sources into existing, living machinery; it does not rebuild derivation or rendering.

### Phase B7 — Setup removal (draft)

After A2 the core no longer asks "who"; this deletes the now-dead ceremony.

- Delete `knowstr init` (`src/cli/init.ts`), the per-workspace `.knowstr/` directory, `.knowstr/profile.json`, `me.nsec`, and `loadCliProfile` as a precondition — `save`/`diff`/`show` run keyless in any directory. (The machine-global `~/.knowstr/` from B2 is unrelated: an invisible cache plus, later, `share`-layer key material.)
- Identity becomes a `share`-layer concern only.

Acceptance: a fresh machine with no prior state runs the `idea.md` walkthrough start to finish with only `save`, `diff`, and `cp`.

## Staged layers (drafts, in pain-driven order)

Per `idea.md`. Automatic discovery (the former `follow`/`knowstr.yaml` layer) is **parked** as an open problem in `idea.md` — the nucleus runs on explicit addresses; do not build a discovery mechanism until usage pain picks one.

1. **`fork <file>`** — eager settling on demand: fresh IDs, `basedOn`, baseline; the answer `save` suggests for workspace-duplicate rejections; the basis for self-variants.
2. **`share <file>`** — publish to relays; the one verb requiring identity. Stamps a durable `track:` (knowstr.com link) so copies are self-connecting; relays become the rendezvous, queryable by node IDs. Requires the non-replaceable snapshot kind (B2), a default relay set, and the local↔relay sync story (encryption or access-controlled relays) before private content publishes.
3. **Groups** — an access-controlled relay: rendezvous, storage, and membership in one address. Token/membership management out of scope.

Also staged: `accept <ref>` (sugar: materialize + set relevance in one command), `detach` (deliberately break lineage), voting aggregates over `knowstr_vote_id`.

## Open problems (tracked in `idea.md`)

Not work items; listed so they aren't re-litigated per phase: automatic discovery (above), baseline advancement for outright-deleted rows, change types beyond added/absent (modifications, re-rankings).

## Final regression phase (draft)

- Full suite and static checks; README/CLI help for the two-command nucleus.
- Verify the `idea.md` invariants one by one.
- Document explicitly deferred work.
