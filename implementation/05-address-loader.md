# Phase B1 — Read-only address loader (execution prompt draft)

Status: **Draft — needs review before execution.**

Prerequisite: Part 1 (A1–A3) is done. The engine speaks `LOCAL` and per-source graphs; `lookupNode` resolves bare ids across sources via `graphIndex.sourceCandidatesById`; documents are keyed by `documentKeyOf(sourceId, docId)`.

Read `idea.md` first. B1 is the one genuinely new module: a pure function from already-read files to read-only source graphs. It is the prerequisite for `diff` (B3), `show` (B5), and the app's drop/paste wiring (B6).

## Core intent

An *address* (file or folder) becomes a set of foreign sources the existing engine can read. Nothing about the address is ever written, persisted, or normalized — loading is observation, not ingestion. Whatever malformation foreign files carry, loading never throws: foreign mess renders as foreign mess or is skipped, because rejecting other people's files is not our call (the one hard rule — duplicate-ID rejection — applies only *inside* the workspace).

## The model

- **One source per file**: `sourceId` = the file's path exactly as the caller supplies it. Per-file namespaces are the unit of correlation (idea.md: duplicates *across* foreign files are variants, not errors).
- **The workspace parser minus its write side**:
  - no ID minting — a node without an explicit `<!-- id:… -->` is **skipped** (it cannot be correlated or referenced, so it does not exist for the engine); children lists of surviving nodes keep only surviving children;
  - no uniqueness enforcement — a duplicate id *within* one foreign file: last occurrence wins (plain `Map.set` order), no error;
  - malformed snapshot/`basedOn` attributes are kept verbatim (A3 already pins lenient foreign parsing);
  - nothing is persisted: the loader returns plain values.
- **Document identity without minting**: `knowstr_doc_id` from frontmatter if present, else the file path. (`parseToDocument`'s `docIdFallback` already supports this; the loader never invents UUIDs.)
- **Determinism**: input `{ path, content, updatedMs }[]` → same output, always. No `Date.now()`, no fs, no randomness. `updatedMs` comes from the caller (file mtime on CLI/Electron, `File.lastModified` on web).

### Signature

One new module, `src/core/sourceLoader.ts` (core because it is pure — CLI, Electron main, and the web drop path all call the same function; only the file *reading* differs per runtime):

```ts
export function loadSourcesFromFiles(
  files: ReadonlyArray<{ path: string; content: string; updatedMs: number }>
): {
  knowledgeDBs: KnowledgeDBs;             // one entry per file, keyed by path
  documents: Map<string, Document>;       // keyed by documentKeyOf(path, docId)
  documentByFilePath: Map<string, Document>;
}
```

The result plugs directly into the existing read machinery: `buildGraphIndexFromDocuments(…, sourceIdByDocumentKey)` indexes it, `lookupNode`/`resolveBlockLinkTarget` resolve within the file's namespace first, `computeVersionDiff` consumes the nodes. B1 adds **no** new lookup, index, or render code.

### File collection (the impure wrapper)

`src/infra/filesystem/addressFiles.ts` — Node-only, shared by CLI and Electron main:

```ts
export async function readAddressFiles(
  address: string                          // file or folder path
): Promise<ReadonlyArray<{ path: string; content: string; updatedMs: number }>>
```

- A file address yields that one file; a folder address yields all `*.md` under it, recursively, sorted (reuse the directory-walk shape of `collectWorkspaceMarkdownFiles`, but **without** `.knowstrignore` — ignore rules are workspace policy and do not apply to foreign addresses).
- `path` values in the result are the address-relative paths for a folder (`holidays.md`, `archive/old.md`), or the file's own basename for a single-file address — these become `sourceId`s and appear verbatim in diff reports, so they must be the names a human would use.
- Unreadable files and non-markdown are skipped silently; a nonexistent address is the wrapper's only error.

## Checkpoints

Full gate after each: `npm run typescript && npm run lint && npm test`.

### Checkpoint 1 — the pure loader

`loadSourcesFromFiles` in `src/core/sourceLoader.ts` with tests (integration-level: feed file fixtures, assert the resulting graphs through `graphLookupFromData`/`lookupNode`, not by poking internals):

- two files, each its own source; a bare id present in both resolves per-file (no bleed);
- a node without an explicit id is absent; its identified children are absent from the parent's children list;
- duplicate id within one file: loads without error, last wins;
- malformed snapshot id loads verbatim, no throw;
- `knowstr_doc_id` respected; missing → docId = file path; same content twice → identical output (determinism).

### Checkpoint 2 — the Node wrapper

`readAddressFiles` in `src/infra/filesystem/addressFiles.ts` with node-environment tests (tmpdir fixtures, like `workspaceBackend.test.ts`):

- file address → one entry; folder address → recursive `*.md`, sorted, address-relative paths;
- `.knowstrignore` in the address folder is **not** honored;
- nonexistent address rejects with a clear message.

## Prohibited moves

- No writes anywhere — not to the address, not to the workspace, not to any store.
- No ID minting, normalization, or "fixing" of foreign content.
- No new lookup/index/diff machinery — if the loaded shape doesn't fit `buildGraphIndexFromDocuments`/`lookupNode`, the loader's output shape is wrong, not the machinery.
- No `Date.now()`/uuid inside the loader.
- The loader does not take an "options" bag. There is one behavior.

## Hard acceptance criteria

- `rg "fs|require\(" src/core/sourceLoader.ts` clean — the core module is runtime-free.
- Loading the same files twice yields deeply equal results.
- A workspace `scanWorkspaceDocuments` of a folder and a `loadSourcesFromFiles` of the same folder differ exactly by: minted ids (absent), id-less nodes (absent), duplicate enforcement (absent), persistence (absent).
- Full gate green.

## Open questions (decide before execution)

1. **Skipped-node subtrees**: a parent *without* an id whose children *have* ids — do the children survive (re-anchored to the nearest identified ancestor / as top nodes) or does the whole subtree drop? Draft says drop only the id-less node itself and re-anchor identified children to the nearest identified ancestor, since their ids are what diff correlates on. The cheaper alternative (drop the subtree) loses real lineage under a cosmetic heading.
2. **`documentByFilePath` keying**: for folder addresses the same relative name can exist in the workspace and the address. The loader returns its own maps (never merged into workspace maps), so collisions can't happen in B1 — but B6 will merge into `Data`. Defer to B6 or prefix now?
3. **Single-file address `sourceId`**: basename (`holidays.md`, human-friendly in reports) vs. the path as given (unambiguous). Draft says basename for reports per idea.md, but `diff` output naming may want the caller's spelling.
