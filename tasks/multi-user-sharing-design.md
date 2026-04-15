# Multi-User Sharing Mechanic

Design conversation, 2026-04-10.

## Core Insight

Knowstr converts markdown into a graph with UUIDs on every node. This means auto-merge is possible: move nodes between files, edit them, fork them — the ID persists. Concurrent edits from multiple users don't conflict, they produce parallel `(?)` suggestions.

## Three Tiers of Storage

- **Local only**: files on disk, `knowstr save` assigns IDs. Never leaves the machine. Default.
- **Shared (encrypted)**: CLI encrypts to specific recipients' keys. Transport-agnostic — relay, email, slack, web, doesn't matter.
- **Public**: opt-in, not the default.

## Outgoing

Files stay wherever they are on disk. `share:` frontmatter marks a file for sharing and declares the audience. Local folder structure is irrelevant to sharing. User curates what to share by composing files — pulling relevant nodes from private wiki into a shareable file.

## Incoming: The Maybe-Relevant Inbox

Each shared space has a flat inbox folder. When `knowstr save` processes incoming files, it does the following:

### Nodes that already exist in your graph
Their updates become `(?)` suggestions on your existing nodes, wherever those nodes live in your files. Nothing stays in the inbox for these — the information is absorbed into your graph.

### Genuinely new content (no overlapping node IDs)
The file stays in the inbox. It's content you haven't seen before and need to triage.

### Mixed case (file has both known and new nodes)
Known nodes become `(?)` suggestions on your existing nodes. The inbox file is trimmed to only contain new nodes, BUT with enough parent context to be meaningful. Like highlighting new items in a printed document — the structure stays for context, markers show what's new.

Example — Alice has "Holiday Destinations > Spain". Bob adds France and reorganizes:
```markdown
- (?) How to save my marriage
  - (?) Doing trips with the wife
    - Holiday Destinations
      - Spain
      - (?) France
```
Unmarked nodes = Alice already has them. `(?)` nodes = new for Alice. Full tree preserved for context.

### Multiple authors, same nodes
If Bob and David both edit the same nodes, `knowstr save` merges them into one inbox file. First version is the base, subsequent changes are `(?)` suggestions with authorship on the nodes. Inbox stays flat — no per-author subfolders.

```markdown
- Holiday Destinations
  - Spain
  - (?) France (David)
```

### Completely unrelated files with same filename
Just rename: `holidays.md` and `holidays-2.md`. Node IDs are what matter, not filenames.

## The Log

Each space has a `~log` file. On save/publish:
- New files: log entry linking to the file (in inbox if foreign, in your graph if yours)
- Edits to existing nodes: log entry noting what changed and linking to the node

The log is the single feed for "what happened." Agents read the log to know what to process.

## Triage

The inbox is processed like email:
- **Accept**: move nodes into your own files. ID persists. `knowstr save` cleans them from inbox.
- **Ignore**: leave it.
- **Contradict/Confirm**: create relations using existing relation types.
- **Delete**: not relevant, remove it.

## Agent Integration

- Agent reads the log to discover what's new
- Processes inbox files — creates relations, forks nodes, integrates into wiki structure
- Private wiki files (no `share:`) are invisible to the relay and other users
- Agent publishes findings back via `share:` frontmatter

## Where the discussion left off

- The inbox mechanic (flat folder, `knowstr save` processes incoming, merges known nodes as suggestions, keeps new content) is solid for N users.
- **Open**: exact behavior when `knowstr save` trims/merges inbox files — how to preserve context trees while removing fully-absorbed nodes.
- **Open**: log format and auto-generation — what exactly goes in a log entry, does save write it automatically.
- **Open**: space identity — how spaces are named, how `share:` resolves to keys.
- **Open**: transport layer — we deliberately left this open. Relay, email, slack, web — the mechanic works regardless.
- **Not started**: CLI commands (`publish`, `pull`), encryption, relay interaction. Foundation discussion first, implementation later.

## Notes after reading current `knowstr save` implementation (2026-04-13)

- `knowstr save` is currently a local-only normalization command. It scans the configured workspace, adds `knowstr_doc_id`, refreshes the editing block, canonicalizes markdown, assigns node IDs, and rejects duplicate document IDs or duplicate node IDs across the workspace.
- Because save ignores `.knowstr`, `.git`, and `node_modules`, raw incoming shared files should live under `.knowstr/...` (or otherwise outside the saved workspace) until they are ingested.
- That means inbox processing should probably be a separate command from `knowstr save` in the first version. Keeping save predictable avoids surprising cross-file merge behavior and avoids duplicate-ID validation failures from raw foreign documents.
- File path is not semantic. Node IDs are the graph merge key. `knowstr_doc_id` is the best existing document-thread identity for “two users edited the same shared document”.
- Recommended first cut: transport drops land in `.knowstr/spaces/<space>/inbox/raw/`; an ingest/apply command reads them, merges by node IDs into the local graph, groups same-document submissions by `knowstr_doc_id`, writes synthesized inbox files plus `~log`, and leaves `knowstr save` as the local-only command.

## Concrete v1 CLI and file layout proposal

### Principles

- `knowstr save` stays local-only.
- Raw incoming shared files never live in the normal saved workspace.
- Node UUIDs are the merge key.
- `knowstr_doc_id` is the shared-document thread key.
- File path and filename are packaging only.

### Local layout

```text
workspace/
  notes/
  projects/
  .knowstr/
    profile.json
    me.nsec
    spaces/
      family/
        space.json
        inbox/
          raw/
          merged/
          archive/
        log/
          latest.md
```

### `space.json`

Minimal first cut:

```json
{
  "name": "family",
  "recipients": ["npub1...", "npub1..."]
}
```

Later this can grow relay/encryption config, but the first UX only needs a stable local space name.

### Command split

#### `knowstr save`

Unchanged meaning:

- normalize local markdown
- ensure `knowstr_doc_id`
- assign node IDs
- reject duplicate IDs in the normal workspace

#### `knowstr inbox apply <space>`

New command for inbox ingestion.

Input:

- `.knowstr/spaces/<space>/inbox/raw/*.md`

Output:

- local graph updates where incoming nodes overlap known node UUIDs
- synthesized inbox docs in `.knowstr/spaces/<space>/inbox/merged/`
- log entries in `.knowstr/spaces/<space>/log/latest.md`
- processed raw files moved to `archive/`

Suggested JSON result:

```json
{
  "space": "family",
  "processed_files": 3,
  "applied_known_node_updates": 8,
  "new_inbox_docs": 1,
  "trimmed_inbox_docs": 2,
  "archived_files": 3,
  "log_path": ".knowstr/spaces/family/log/latest.md"
}
```

### Ingestion algorithm

1. Parse all raw inbox files.
2. Read sender metadata from transport envelope or frontmatter.
3. Group raw files by `knowstr_doc_id`.
4. Build a local index of known node UUIDs from the saved workspace.
5. For each incoming node UUID:
   - if UUID exists locally, create/update an incoming suggestion on that known node
   - if UUID does not exist locally, mark it as new
6. For each `knowstr_doc_id` group, synthesize one merged inbox doc containing only new nodes plus the minimal ancestor context needed to explain them.
7. Write log entries for:
   - new inbox doc created
   - known node got incoming suggestions
   - inbox doc fully absorbed and removed
8. Move raw files to archive.

### Rule for synthesizing trimmed inbox docs

Keep an incoming node in the merged inbox tree iff:

- the node is new locally, or
- it has at least one descendant that is kept

Marking rule:

- new node: `(?)`
- known context node: unmarked context only
- known node with an incoming text change: do not keep a second visible copy in inbox if it has no kept descendants; instead attach the authored suggestion to the local known node and mention it in the log

This gives one clean pruning rule:

> keep new nodes and the ancestor closure needed to reach them

### Same document edited by multiple users

If Bob and David both submit files with the same `knowstr_doc_id`:

- they belong to one inbox thread
- their raw filenames do not matter
- known-node edits from both users attach to the same local known nodes as parallel authored suggestions
- genuinely new nodes from both users are merged into one synthesized inbox doc for that `knowstr_doc_id`

### Explicit answer on file structure relevance

- sender path: not semantic
- sender filename: not semantic
- local path: not semantic for merge
- `knowstr_doc_id`: semantic for document-thread grouping
- node UUID: semantic for graph merge

## Frontend merge rules today

Current app behavior is built around fork/version lineage, not shared inbox documents.

### What it does today

- Version families are discovered via `basedOn` lineage in `semanticIndex.basedOnIndex`.
- Suggestions are computed in `src/semanticProjection.ts#getAlternativeFooterData`.
- Diffs are computed in `src/domain/snapshotBaseline.ts#computeVersionDiff` by comparing child lists against a snapshot baseline.
- Accepting a suggestion deep-copies the foreign node into the local tree and sets `basedOn`.
- Declining a suggestion stores a local `not_relevant` shadow copy/ref so the virtual suggestion stays hidden.
- Frontend does not parse `knowstr_doc_id` into structured metadata.

### What that means

The current frontend merge layer is good for:

- readonly fork → editable copy
- showing child additions from another version
- hiding/accepting suggestions in a fork/version workflow

It is not sufficient for the planned inbox mechanic because:

- shared inbox updates are keyed by persistent node UUIDs, not by `basedOn` copy lineage
- two users editing the same shared document need grouping by `knowstr_doc_id`, which the frontend does not know about today
- same-node text edits need alternative-value handling, not only child add/remove diffs
- accepting an inbox suggestion should often preserve the shared UUID, while the current accept flow creates a new local copy with `basedOn`

## Frontend changes needed

### Keep as-is

- Existing fork/version suggestions based on `basedOn` and snapshots
- Existing cref incoming-ref logic
- Existing visible-author filtering rules

These remain useful for explicit fork workflows.

### Must change for shared-space inbox support

#### 1. Add structured shared-document metadata

The frontend needs to parse and index at least:

- `knowstr_doc_id`
- share space identity
- sender / authorship metadata for incoming inbox suggestions

Today frontmatter is opaque and not queryable.

#### 2. Add a shared-node identity index

The frontend currently indexes cross-version families via `basedOn`.
For inbox merging it also needs a second identity path based on persistent node UUID / short ID across authors and documents.

In practice this likely means adding something like:

- `stableNodeId` or `sharedUuid` on parsed nodes
- an index from shared UUID to all visible variants/suggestions

#### 3. Separate fork versions from inbox suggestions

The app should not overload one algorithm for both cases.
Use two layers:

- fork/version layer: existing `basedOn` + snapshot diff logic
- inbox/shared layer: same-UUID and same-`knowstr_doc_id` merge logic

#### 4. Support same-node text alternatives

`computeVersionDiff()` only compares children. Inbox support needs a second diff type for:

- text changed on same UUID
- metadata changed on same UUID
- maybe also moved parent on same UUID

This probably means a node can have:

- child suggestions
- alternative text suggestions
- alternative parent/context suggestions

#### 5. Change accept/decline semantics for inbox items

Current accept = deep copy with new local ID and `basedOn`.
For shared-space inbox items, accept should usually mean:

- keep the stable shared UUID
- move/adopt the node into local files without inventing a new identity

Current decline = create a hidden local `not_relevant` copy/ref.
For inbox items, decline should instead be stored as a review decision keyed by shared UUID or inbox suggestion identity, not as a copied shadow node.

#### 6. Add document-thread grouping UI

When Bob and David both edit the same `knowstr_doc_id`, the UI should show one thread/inbox item with parallel authored suggestions, not separate unrelated version stacks just because they came from separate files.

#### 7. Revisit suggestion dedupe rules

Current suggestion pooling dedupes by `(basedOn ?? id)` and also suppresses candidates whose semantic text already exists locally.
That is reasonable for fork suggestions, but inbox merging may need different dedupe rules because:

- same shared UUID across authors should be grouped intentionally
- same text does not necessarily mean same suggestion
- multiple authored alternatives on one UUID should not be collapsed away accidentally

## Recommended sequencing

### Phase 1

- implement `.knowstr/spaces/<space>/inbox/raw/`
- implement `knowstr inbox apply <space>`
- keep inbox/log as CLI workspace artifacts
- do not change frontend merge behavior yet

### Phase 2

- parse `knowstr_doc_id` and shared UUID metadata in frontend
- add separate inbox/shared merge indexes
- show space inbox threads and per-node authored suggestions

### Phase 3

- unify accept/decline UX so shared inbox items preserve stable IDs while fork/version items keep using `basedOn`
