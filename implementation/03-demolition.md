# Phase A1 — Demolition execution prompt

Status: **Not started**.

We are removing all multi-user machinery before introducing the source boundary (Phase A2). Read `AGENTS.md` and `idea.md` first — especially the suggestion lifecycle (materialization is the only engine transition; "accept" is not an operation) and the invariants. Treat the keep-list and the hard greps below as mandatory.

## Core intent

The existing multi-user features are built on two retired primitives — **author-as-boundary** and **text-equality-as-identity across users** — and are deleted, not migrated. After this phase the app is a clean single-user editor on all three runtimes: the web app loads, edits, and syncs only the logged-in user's own graph; CLI and Electron are unchanged except for deleted dead surfaces. Collaboration returns later, driven by the diff engine (Phase B3/B6), on the source boundary (Phase A2).

Delete means delete: no feature flags, no inert UI left in place, no "keep the type for later", no optional parameters to preserve old call shapes, no compatibility fallbacks.

## Keep-list (looks multi-user, is not — breaking these fails the phase)

- **Fork/lineage machinery**: `basedOn`, node-level snapshots, `DeepCopy`, `computeVersionDiff` (`src/core/snapshotBaseline.ts`), snapshot events/store. This is variant machinery and the future diff engine's foundation. `src/editor/DeepCopy.test.tsx` stays green throughout.
- **Incoming refs and search**: `findRefsToNode`, `getIncomingCrefsForNode` (`src/semanticProjection.ts`), `localSearch.ts`, `LoadSearchData.tsx`, `Row.virtualType` values `"incoming"` and `"search"`. `src/editor/IncomingRefInteraction.test.tsx`, `References.test.tsx`, `Search.test.tsx`, `SearchResults.test.tsx` stay green.
- **Self-variant version/suggestion overlays**: the `basedOn`-lineage version walking (`getVersions` and friends), `[V]` rows with add/remove counts, `(?)` suggestion rows, `Row.versionMeta`, the `"suggestions"`/`"versions"` type filters, and all their rendering. Single-user feature (a fork is a version of its original) and Phase B6's landing pad. Only their text-equality suppression and cross-author inputs die (checkpoint 3).
- **Opening a foreign link read-only (the web's address loader seed)**: the pane-author ad-hoc loading path — `extraAuthors` from `panes` in the sync filter (`NostrCacheSync.tsx:117-127`) and the per-pane-author relay-metadata discovery (`NostrDataProvider.tsx:96-121`). Opening `…?source=<npub>` loads that namespace read-only without any contact relationship; this is what B6 turns into "opening a link is `diff <address>`". It works logged-out (viewing never requires login).
- **The semantic-ID substrate** (`getSemanticID`, `getNodeSemanticID`, `isEmptySemanticID`, semantic contexts in `core/connections.tsx`, `core/plan.ts`, `treeMutations.ts`, `dnd.tsx`, display fallbacks in `documentRenderer.ts:35` / `Workspace.tsx:152`): **out of scope for this phase.** It serves search, incoming refs, context chains, and empty-row checks — single-user editor internals. After demolition only one graph exists, so no text matching crosses a user boundary; whether these internals migrate to concrete IDs is revisited with Phase B6, not here. Only the *suggestion-suppression* use dies (checkpoint 2).
- **Web login**: `SignIn.tsx`, `SignUp.tsx`, `AuthProvider.tsx`, `NostrAuthContext.tsx`, own-key event signing/publishing, own-author `permanentSync`. Identity is the web workspace's container.
- **`UserRelayContext`** (`src/UserRelayContext.tsx`): the user's own relay configuration. Only contact-relay aggregation dies.
- The 1A `SourceId`/`graphLookup` machinery. Where it consumes `data.contacts` for deterministic source-candidate ordering (`src/core/graphLookup.ts`), the candidate list becomes empty — keep the mechanism, it is re-fed by address loaders in Phase B1.

## Checkpoints

Run the full gate after every checkpoint: `npm run typescript && npm run lint && npm test`. Do not continue with red checks. No `--runInBand`.

### Checkpoint 1 — Delete `RootAnchor` entirely (fold its one real consumer first)

`RootAnchor` is two unrelated jobs on root nodes: a frozen breadcrumb (`snapshotContext`/`snapshotLabels` — stale text captured at copy time, serialized as `anchorContext=`/`anchorLabels=`, a third file vocabulary that `idea.md` forbids) and a source pointer (`sourceAuthor`/`sourceRootID`/`sourceNodeID`/`sourceParentNodeID`) that duplicates `basedOn` — `core/plan.ts:456-467` writes both from the same source node in one statement. The whole concept goes; the breadcrumb display is lost (re-derivable live from `basedOn` later if ever missed).

1. **Fold first**: `getSnapshotSourceRoot` (`src/planner.tsx:711-723`) and the source resolution in `src/editor/Workspace.tsx:187-196` re-derive the snapshot source from the root's `basedOn` + node-centric snapshots instead of anchor fields. `DeepCopy.test.tsx` stays green.
2. **Then delete the concept**: the `RootAnchor` type and `GraphNode.anchor` (`src/types.ts:267-274,289`); `src/core/rootAnchor.ts` (`createRootAnchor`, `getRootAnchorContext`, `rootAnchorsEqual`); anchor creation in `src/core/nodeFactory.ts:35`, `src/core/plan.ts:456-465,506-509`, `src/core/markdownNodes.ts:107,238`; markdown parsing (`src/core/markdownTree.ts:66-97`); the file format (`src/documentFormat.ts` root attrs incl. `anchorContext`/`anchorLabels`); serialization (`src/documentRenderer.ts:78`); breadcrumb rendering (`src/editor/Workspace.tsx:221-230`). (The `sourceAuthor` in `src/infra/snapshotStore.ts:30-43` is snapshot-*event* metadata, not `RootAnchor` — it moves to checkpoint 6 with the rest of the cross-author fetch path.)
3. Update tests pinning anchor round-trips (`Document.test.ts`, `MultiTopNodeDocuments.test.tsx` and friends).

**Unrelated "anchor" naming — leave alone**: `useTemporaryView().anchor` (multiselect anchor, `TreeView.tsx`, `DroppableContainer.tsx`), `globalDragIndent.anchorX` (drag state), and the `anchor` field in `userSessionState.ts:30`. Do not grep-delete these.

### Checkpoint 2 — Dead vocabulary

- Delete the `hidden` attribute end to end: parse (`src/core/markdownTree.ts:61,320`), materialization filters (`src/core/markdownNodes.ts:124,228`), root selection (`src/core/Document.ts:135-137,172`), format option (`src/documentFormat.ts`). It has no production writer and silently deletes user rows on save.

### Checkpoint 3 — Suggestion/version producer: cut text equality and cross-author inputs, keep the lineage feature

The `[V]` version rows ("+x/−y") and `(?)` suggestion rows are **not** inherently multi-user. `getVersions`/`getPastVersions`/`getFutureVersions` (`src/semanticProjection.ts:487-584`) walk the `basedOn` lineage — past chains and the `basedOnIndex` — which are the correct primitives, and they work entirely within one workspace: a forked/deep-copied document is a version of its original. **This feature stays, single-user**: fork a document and the original shows the fork as a `[V]` row with add/remove counts, and the fork's drift as `(?)` suggestions. Phase B6 later feeds foreign sources into this same living producer.

Delete only what violates the model:

- **Text-equality version detection**: `nodesMatchForVersion` (`src/buildReferenceRow.ts:318-329` — *not* orphaned: called at ~714 to present same-text-same-context reference rows as versions of the parent). Version relations come from `basedOn` lineage only; the text-match branch goes.
- **Text-equality suppression** inside `getAlternativeFooterData` (`src/semanticProjection.ts`: the `currentSemanticIDs` set at ~615-617 and its uses in suggestion dedupe ~649-651 and `addCount`/`uncoveredAddCount` filtering ~678-690): every `getNodeSemanticID` check goes; suppression is `originKey` (`basedOn ?? id`) only. Deliberate behavior change: same text with different origin is no longer suppressed — model-correct.
- **Cross-author inputs**: `visibleAuthors` built from `data.contacts` (`src/treeTraversal.ts:559-564`) shrinks to the user's own graph; `isVisibleVersion` author filtering simplifies accordingly (fully vacuous after checkpoint 4 deletes contacts).
- **Multi-user test fixtures**: the "Bob forks…" scenarios in `src/editor/SuggestionDisplay.test.tsx` — replace with self-fork coverage built on the DeepCopy flow, pinning: a fork shows as `[V]` with correct counts on its original; the fork's new children appear as `(?)` suggestions; suppression is `originKey`-based; the existing `not_relevant`-ref decline suppression (`declinedTargetIDs` — already lineage-honest) keeps working.

Explicitly kept: `getVersions`/`getPastVersions`/`getFutureVersions`, `getAlternativeFooterData` (slimmed), `computeVersionDiff`, `Row.versionMeta`, `Row.virtualType` `"suggestion"`/`"version"` and all their rendering branches, the `"suggestions"`/`"versions"` type filters, and the virtual-row machine (`appendVirtualFooterRows`/`createVirtualRow`, `treeTraversal.ts:336-470`) shared with incoming refs.

### Checkpoint 4 — Follow/contacts

"Follow" in this codebase *is* the NIP-02 contact list. All of it goes:

- Follow/unfollow UI: `editor/Node.tsx:855-890` (buttons, followed-user styling), `editor/RightMenu.tsx:49-100` (actions, `data.contacts.has(...)` checks).
- Plan layer: `planAddContacts`, `planRemoveContact`, `planUpsertContact`, `newContactListEvent` (`src/core/plan.ts:66-193`, exports in `src/planner.tsx:68,75`).
- `src/contacts.ts` (`findContacts`, `FollowList`) and its merge in `src/eventProcessing.ts:3,27,31`; `src/contacts.test.ts`.
- `KIND_CONTACTLIST` (`src/nostr.ts:6`) and its subscription in `src/infra/nostr/NostrDataProvider.tsx:34,75,127`.
- Types: `Contact`, `Contacts`, `FollowList` (`src/types.ts:87-98`); `Data.contacts` and `Data.contactsRelays` (`src/types.ts:160-164`) and every consumer (`DataContext.tsx`, `treeTraversal.ts:582-583` `visibleAuthors`, `core/graphLookup.ts` candidate ordering — becomes empty per keep-list).
- Tests: delete `editor/UsersEntries.test.tsx`, `editor/UsersNavigation.test.tsx`; update `utils.test.tsx` contact fixtures.

### Checkpoint 5 — User entries

- `src/infra/nostr/userEntry.ts` (`getNodeUserPublicKey`, `withUsersEntryPublicKey`) and the calls in `src/planner.tsx:101,107,521`, `src/rowModel.tsx:285`.
- `GraphNode.userPublicKey` (`src/types.ts:291`) including its file-format serialization (`src/documentFormat.ts:45`) — author-shaped metadata leaves the markdown format.
- Delete `decodePublicKeyInputSync` (`src/infra/nostr/publicKeys.ts`) if user entries were its last consumer; keep it if login input parsing uses it.

### Checkpoint 6 — Cross-author sync and contact relays

**Careful: sync authors are `contacts ∪ paneAuthors`. Only the contacts half dies.** The pane-author half (`extraAuthors`) is the ad-hoc link-viewing path on the keep-list — deleting it breaks "open a link someone sent me, see it read-only".

- `buildPermanentSyncAuthors(myself, contacts)` (`src/permanentSync.ts:39-44`): delete the helper; the author list in `src/infra/nostr/cache/NostrCacheSync.tsx:117-130` becomes `[user.publicKey, ...extraAuthors]` — own author plus pane authors, no contacts.
- Contact-relay aggregation: `useContactsRelays` and the contacts-fed parts of `src/relays.tsx:21-70,106-110`, `ContactRelaysDisplay` (`src/editor/Relays.tsx:216-344`), `contactsRelays` from relay-URL selection (`NostrCacheSync.tsx:140,146`). The per-pane-author `KIND_RELAY_METADATA_EVENT` query (`NostrDataProvider.tsx:101-121`) **stays**, fed by `extraAuthors` only — it is how a foreign link's events are found on that user's relays.
- Update `permanentSync.test.ts`, `MetaQuery.test.tsx`, `relays.test.tsx` accordingly; viewing a foreign pane (route with `?source=<other-npub>`) must still load and render read-only — keep or add a test pinning this.

### Checkpoint 7 — Pre-login editing dies; logged-out web is a viewer

- Delete `src/StorePreLoginContext.tsx` (pre-login event queue + merge-on-login), its wrap in `editor/Dashboard.tsx:6,28`, its use in `SignIn.tsx:17`, and the key-upgrade path in `src/planner.tsx:648`.
- Logged out, the web app creates no events and shows no editing affordances: gate edit surfaces on a logged-in user. Read/viewing keeps working.
- `UNAUTHENTICATED_USER_PK` remains only as the logged-out session sentinel (`userSessionState.ts:54`, `NostrAuthContext.tsx:27`) — it must no longer appear as an author on any plan, event, or node. Representing logged-out as "no workspace" instead of a sentinel key is finished in Phase A2 with `LOCAL`.
- Update `SignIn.test.tsx`, `PaneContext.test.tsx:311`, `utils.test.tsx` fixtures.

## Prohibited compatibility moves

Do not introduce:

- feature flags or config switches for any deleted surface;
- inert UI (filter buttons, menu entries, buttons that no longer do anything);
- optional `contacts`/`contactsRelays` parameters to avoid updating call sites;
- migration code for persisted pane `typeFilters` state;
- placeholder identities anywhere new; `UNAUTHENTICATED_USER_PK` only shrinks;
- new casts or type assertions while updating call sites.

## Hard greps (all must be clean in `src/` before reporting done)

```sh
rg "nodesMatchForVersion" src
rg "getNodeSemanticID|currentSemanticIDs" src/semanticProjection.ts   # suggestion path is originKey-only (getSemanticID stays in the kept incoming-refs/search substrate)
rg "nodesMatchForVersion" src
rg "findContacts|FollowList|planAddContacts|planRemoveContact|planUpsertContact|KIND_CONTACTLIST" src
rg "contactsRelays|useContactsRelays|buildPermanentSyncAuthors" src
rg "userPublicKey|withUsersEntryPublicKey|getNodeUserPublicKey" src
rg "StorePreLoginContext|useStorePreLoginEvents" src
rg "RootAnchor|createRootAnchor|rootAnchorsEqual|getRootAnchorContext" src
rg "anchorContext|anchorLabels|snapshotContext|snapshotLabels" src
rg "sourceAuthor|sourceRootID|sourceNodeID|sourceParentNodeID" src
rg "hidden" src/core/markdownTree.ts src/core/markdownNodes.ts src/documentFormat.ts src/core/Document.ts
```

`rg "contacts" src` may have residual hits only in comments/tests being updated in the same checkpoint — by the end of the phase it must be clean too.

## Acceptance criteria

- All hard greps clean; the keep-list test files green; full gate green.
- Web: login, editing your own graph, own-event sync, search, incoming refs, fork/deep-copy all work; logged out, the app is read-only.
- CLI `save` and Electron load/save behavior unchanged.
- Net diff of the phase is strongly negative in lines of code; no new files except this prompt.
