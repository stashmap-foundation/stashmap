# Phase A2 — Source boundary execution prompt

Status: **Not started**. Prerequisite: Phase A1 (`03-demolition.md`) is done — contacts, user entries, `RootAnchor`, pre-login editing, and cross-author sync are gone; `GraphNode.author` is single-valued everywhere.

Read `idea.md` first. Treat the model below and the acceptance criteria as mandatory.

## Core intent

The boundary between "mine" and "not mine" becomes a property of **which source a node was loaded into**, never of who authored it. Exactly one source is writable. The engine speaks a *relative* name for it; everything that leaves the app speaks *absolute* addresses.

> **`LOCAL` is relative, addresses are absolute** — like `~` versus `/home/alice`. URLs, files, and events carry absolute addresses; the engine carries `LOCAL`. One session-aware resolver per direction translates at the boundary, and nowhere else.

Vocabulary (engine-only; users see "workspace" and "address" per `idea.md`): a **source** is a namespace nodes were loaded from; the workspace is the only source Knowstr writes back to.

## The model

- `LOCAL: SourceId = "local"` — one constant, in `src/core/nodeRef.ts` (existing file; do not create a new module). The literal is identical on CLI, Electron, and web.
- `KnowledgeDBs = Map<SourceId, KnowledgeData>`; `documentKeyOf(sourceId, docId)`.
- `GraphNode` carries **no source field and no author**: a node is content + lineage (`id`, `spans`, `basedOn`, `snapshotId`, relevance/argument, structure). Where it lives is the map key, carried at boundaries by `NodeRef { sourceId, id }`.
- Producers of the map:

  | Producer | Feeds | Notes |
  | --- | --- | --- |
  | workspace scan (CLI/Electron) | `LOCAL` | the profile pubkey stops participating in materialization; the profile file itself dies in B7 |
  | own-event sync (web) | `LOCAL` | inbound translation: events authored by the session key file under `LOCAL` |
  | pane-author ad-hoc sync (web) | `sourceId = <npub>` | the link-viewing path preserved in A1 checkpoint 6 |
  | file/folder loader (B1, later) | `sourceId = <file path>` | one source per file |

- The npub exists only at the **relay boundary**: the publish path signs `LOCAL`-graph events with the session key; the sync path files own-authored events under `LOCAL`. No pubkey appears in core graph state, panes, or routes for own content.
- **Writes are unrepresentable, not guarded**: planner/mutation functions take plain `ID` (always meaning `LOCAL`) and the plan carries only the local graph. A foreign `NodeRef` cannot be passed to a mutation because no parameter accepts one. Foreign nodes enter mutations only as already-resolved `GraphNode` *values* (settle-at-the-door inputs to copy flows), never as mutation targets.
- The UI discriminates with one predicate, in one layer: `row.ref.sourceId === LOCAL` decides whether a row offers edit verbs or boundary-crossing verbs.

### The address boundary (web)

Two pure, session-aware functions, both living in `src/navigationUrl.ts` (existing module — routes are its job):

```ts
resolveAddress(address: string, session): SourceId
// inbound: any npub spelling that denotes the session's own container → LOCAL;
// anything else → the normalized absolute address as SourceId.

addressForSource(sourceId: SourceId, session): string | undefined
// outbound: LOCAL → the session's own absolute address (web: npub form);
// foreign → the address itself; undefined when the session has no own
// container (logged out; keyless desktop until the share layer).
```

Rules:

- **The web address bar is always absolute**, including while browsing your own workspace: copying the URL from the bar *is* sharing. The same URL resolves per viewer — to `LOCAL` for its owner, to a read-only foreign source for everyone else, to a foreign source for the logged-out viewer.
- Own-npub → `LOCAL` is a **web-only resolver rule**, because only on web is the npub the workspace's container. When desktop later speaks npub addresses, its resolver rule is the opposite: your own npub is your *deposit* (a foreign source; `diff` reports ok/stale). The resolver asks "is this address the namespace my workspace lives in", not "is this my key".
- All npub spelling normalization (bech32 `npub1…`, hex, knowstr.com path forms, nostr URIs) lives **inside the resolver only**. No fuzzy address matching anywhere else.
- Pane state (in memory and serialized) stores the engine form: `LOCAL` or the normalized absolute foreign address. Only URL generation re-absolutizes. A login-key change invalidating stored panes is acceptable pre-release breakage.
- Logged out, the session has no own container: nothing resolves to `LOCAL`, the `LOCAL` graph is empty, and edit affordances are absent — the viewer behavior falls out with zero special-casing.

## Checkpoints

Full gate after each: `npm run typescript && npm run lint && npm test`. No `--runInBand`. Do not continue with red checks.

### Checkpoint 1 — `LOCAL` and the source-keyed container

- Add `LOCAL` to `src/core/nodeRef.ts`. Re-key `KnowledgeDBs` and `documentKeyOf` by `SourceId`.
- Workspace scan/materialization (`src/infra/filesystem/`, `src/core/markdownNodes.ts`) assigns `LOCAL`; the CLI profile pubkey stops participating (profile loading itself remains until B7, as dead weight).
- Web inbound sync files own-authored events under `LOCAL`; pane-author events under their npub.
- Delete the `explicitSourceId ?? node.author` fallback (`src/graphIndex.ts:84`): indexing requires an explicit `SourceId`.

### Checkpoint 2 — Delete `GraphNode.author`

- Remove the field (`src/types.ts:294`). Event building receives the signing pubkey at the publish boundary (`src/planner.tsx` publish path / `src/nostrEvents.ts`), not from nodes.
- Every `getNode(…, node.author)`-style read callsite switches to the `NodeRef`/explicit-source form (the 1A lookup helpers already exist).

### Checkpoint 3 — Mutations unrepresentable outside `LOCAL`

- Planner/mutation functions (`src/core/plan.ts`, `src/treeMutations.ts`, `src/planner.tsx`, `src/dataPlanner.ts`) take plain `ID`/explicit inputs; the plan carries only the local graph.
- Delete the editability guards (`planner.tsx:95,872`, `treeMutations.ts:48,86`, `dataPlanner.ts:19`) — with no foreign refs expressible, they have nothing left to check. Do not replace them with `LOCAL` checks inside mutation code.
- Foreign inputs to copy/settle flows arrive as resolved `GraphNode` values plus their source graph, never as mutation targets.

### Checkpoint 4 — Pane, session, and the end of the sentinel

- Delete `Pane.author` (`src/types.ts:143`); `Pane.sourceId` is the only source state. `defaultPane` takes no author (`src/userSessionState.ts:19-24`).
- The read-only flag (`src/rowModel.tsx:260`) becomes `row.ref.sourceId !== LOCAL`; edit verbs render only for local rows, boundary-crossing verbs only for foreign rows.
- Delete `UNAUTHENTICATED_USER_PK` entirely: logged-out is an *absent* session key, not a sentinel one. Update `userSessionState.ts:54`, `NostrAuthContext.tsx:27`, and remaining test fixtures.

### Checkpoint 5 — The address boundary

- Implement `resolveAddress`/`addressForSource` in `src/navigationUrl.ts` with the rules above; route parsing and URL generation go through them exclusively.
- Web address bar shows the absolute form for own content; opening a URL whose address denotes the session's own container lands in the editable workspace pane; the identical URL under a different (or no) session lands in a read-only foreign pane.
- Npub normalization helpers are imported only by `navigationUrl.ts` (and `SignIn` for key input).

### Checkpoint 6 — Electron writes files only

- The desktop write path constructs no Nostr events: edits go through the filesystem runtime (`workspace:save` IPC) exclusively. Event construction/signing code is reachable only from the web publish path (and later the `share` layer).

## Prohibited compatibility moves

- No `author` field kept "for events" — the signing key enters at the publish boundary as a parameter.
- No dual keying (author *and* sourceId) anywhere, however temporary.
- No `LOCAL` checks inside planner/mutation code — if one seems needed, the signature is wrong.
- No second URL scheme: there is no "internal share link" distinct from the address bar.
- No address parsing outside `navigationUrl.ts`; no npub normalization outside the resolver (+ SignIn key input).
- No optional `sourceId` parameters defaulting to `LOCAL` — callers state their source explicitly.

## Hard acceptance criteria

Greps (all clean in `src/` unless stated):

```sh
rg "\.author\b" src                          # no node/pane author reads anywhere
rg "author" src/types.ts                     # the word is gone from graph/pane types
rg "UNAUTHENTICATED_USER_PK" src
rg "Map<PublicKey, KnowledgeData>" src
rg "LOCAL" src/core/plan.ts src/treeMutations.ts src/dataPlanner.ts   # mutations never check
rg "documentKeyOf" src                       # every call site passes a SourceId (manual review)
rg "nip19|npub1" src --type ts -l            # only navigationUrl.ts, SignIn/key input, and nostr infra
```

Behavior (each pinned by a test):

- **Same URL, three viewers**: a document URL containing the owner's npub renders (a) editable workspace for the owner's session, (b) read-only foreign pane for another session, (c) read-only foreign pane logged out.
- **Round trip**: `addressForSource(resolveAddress(url, session), session)` reproduces the canonical absolute URL for both own and foreign addresses.
- **Own-URL canonicalization**: opening your own shared URL does not create a second source — no duplicate of your document appears, and the pane's `sourceId` is `LOCAL`.
- **Address bar absolute**: navigating your own document produces a URL containing your npub, and pasting exactly that URL elsewhere works (case (b) above).
- **Logged-out web**: no edit affordances render; no plan/event is constructible; viewing foreign URLs works.
- **CLI/Electron**: `knowstr save` round-trip output is byte-identical to pre-A2 for a workspace without author-era metadata; Electron edits produce file writes and zero Nostr events.
- **Read-only rows**: a foreign pane's rows offer no edit verbs; copy-to-edit from a foreign row mints a fresh local node with `basedOn` (existing DeepCopy coverage extended to assert the new node lands under `LOCAL`).
- Full gate green: `npm run typescript && npm run lint && npm test`.
