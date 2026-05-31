# Knowstr collaboration model v2

Knowstr is a markdown-first graph editor. Users think in small text blocks, arrange them into documents, link them into a graph, and keep the underlying files readable and editable as normal markdown.

The collaboration problem is not shared mutable editing. In an agent-centric world, every person has their own second brain, with their own graph, structure, priorities, and agents. Collaboration should let people work on the same question, document, or subtree without giving anyone the ability to overwrite someone else’s concrete graph entities.

The model is:

> A Knowstr workspace is my editable graph. Sources are read-only inputs. Importing creates my editable fork from a source. Suggesting reads sources and derives local `(?)` suggestion overlays. Accepting/copying creates editable local nodes. Documents are markdown containers. Nodes carry lineage through `basedOn` and node-centric `snapshot` baselines.

This is not Google Docs. It is not shared mutable node IDs. But it can still consume shared mutable markdown directories, Git repos, FTP folders, or Nostr documents as sources.

## Core principles

### 1. Workspace vs sources

The main distinction is not “mine vs foreign author”. The main distinction is declared by location/configuration:

```text
workspace = editable / part of my graph / saved by knowstr save
sources   = read-only input / used by knowstr suggest
```

A stateful Knowstr workspace is created explicitly with:

```sh
knowstr init
```

No command creates `.knowstr` implicitly. Commands that need persistent workspace state must fail with a clear message if no initialized workspace exists.

Additional read-only inputs are declared with:

```sh
knowstr source add <file-or-dir>
```

A source may be authored by someone else, by me, by a shared group, or by no explicit author at all. Knowstr does not use author metadata to decide who is allowed to edit. Filesystem, Git, FTP, Nostr signatures, or another transport decide that.

Knowstr only follows this rule:

- workspace files may be rewritten by Knowstr commands/actions such as `save`, `import`, and accepting/copying suggestions
- source files are never rewritten by Knowstr

### 2. Standalone save does not require a workspace

A single markdown file or explicit set of files can be normalized without creating a Knowstr workspace:

```sh
knowstr save notes.md
knowstr save docs/a.md docs/b.md
```

Standalone save is stateless. It may assign missing document IDs and node IDs in the given files, preserve existing `basedOn`, `snapshot`, and `knowstr_vote_id`, and reject duplicates within the explicit file set. It does not track sources, create snapshots, read workspace config, or create `.knowstr`.

Stateful collaboration commands require an explicit workspace created by `knowstr init`:

```sh
knowstr source add <file-or-dir>   # requires .knowstr
knowstr import <source-file> ...   # requires .knowstr
knowstr suggest                    # requires .knowstr
```

This keeps markdown-first single-file usage lightweight while making persistent collaboration state intentional.

### 3. Plain markdown remains valid

A markdown file with no Knowstr metadata is valid:

```md
# Holiday Destinations
- Spain
- Italy
```

When normalized by `knowstr save`, Knowstr may add frontmatter, document IDs, and node IDs.

### 4. Node IDs are UUIDs, with a temporary internal author prefix

New Knowstr node IDs in markdown should be UUID-like and globally unique in practice:

```md
- Spain <!-- id:550e8400-e29b-41d4-a716-446655440000 -->
```

The current implementation still represents internal graph IDs as `author_uuid`. That is a compatibility detail, not part of the collaboration semantics. Moving forward, the author prefix must not decide editability, permissions, source status, or merge behavior. Workspace/source declaration decides editability.

A future migration should remove author significance from concrete node identity and move fully to globally unique UUID node IDs.

Because IDs are UUIDs, no author metadata is needed for collision avoidance.

### 5. Documents are containers, not lineage

A document is a markdown container for one or more root nodes.

`knowstr_doc_id` identifies a concrete document container. It is fresh/random and should not be reused to mean “same collaboration”. A whole-document import/fork creates a new `knowstr_doc_id`.

Documents do not have lineage. Nodes do.

```text
knowstr_doc_id = concrete document container ID
basedOn        = node provenance/source node for a lineage edge
snapshot       = immutable source baseline for that node's basedOn edge
knowstr_vote_id = optional future voting scope
```

`basedOn` and `snapshot` belong together. They describe a node-level lineage edge from my local node to a source node and the exact source state used as the baseline for later diffs.

### 6. Import creates a fork

Import is the explicit operation that crosses from source into my graph:

```text
source document -> my workspace document
```

Import creates new local node IDs, points them to source node IDs with `basedOn`, creates a `snapshot`, and writes an editable workspace file.

### 7. Suggest derives local suggestion overlays

Suggest is the explicit operation that crosses source variants into my workspace as derived suggestions:

```text
source/current variants + my local graph + snapshots -> local (?) overlays
```

A suggestion is derived from the node-centric diff. It is not proof that a source file was scanned, and it does not require a separate source-run or suggestion-status log. The UI may render suggestions as `(?)` overlays. A CLI may render them in text/JSON or materialize proposal markup, but the source node itself is not inserted into my editable graph.

Ordinary suggestion computation does not create a new snapshot. It uses existing `basedOn` + `snapshot` lineage edges to compute three-way diffs where available.

The source file is untouched.

### 8. Accepting/copying creates node lineage edges with snapshots

When a suggestion or source node is accepted/copied into the workspace, Knowstr creates local node IDs and records a node-level lineage edge:

```md
- Kroatia <!-- id:alice-new-uuid basedOn="bob-source-uuid" snapshot="snap_bob_state_at_accept" -->
```

The `snapshot` is the source state at the time this edge was created. It is not only document/root metadata. Each copied node with `basedOn` must either carry its own `snapshot` or resolve to an explicit node-centric snapshot for that same lineage edge.

This allows later diffs such as:

```text
base   = bob-source-uuid in snap_bob_state_at_accept
local  = alice-new-uuid now
source = bob-source-uuid now
```

So later source edits can be inferred from the diff, e.g. Bob changing `Kroatia` to `Croatia`, without storing an explicit accepted/ignored status.

### 9. Snapshots are immutable node-edge baselines

A snapshot records source markdown/subtree state as seen when a lineage edge is created: import, fork, copy, or accept.

- created by the workspace owner when importing/forking/copying/accepting source nodes
- not created by ordinary `suggest` overlay computation
- immutable
- may be shared by many nodes copied from the same source state
- the snapshot ID may be a hash of raw source markdown
- workspace-backed storage: `.knowstr/snapshots/<snapshot-id>.md`
- IndexedDB may cache snapshots, but should not be the only durable store for workspace/CLI/desktop use
- browser/Nostr-only storage may use immutable Nostr snapshot events plus IndexedDB cache until workspace-backed storage is available

`snapshot` must not point only to a mutable source path or current document address.

Snapshot lookup must be node-centric, not root/document-centric. To diff a local node against a source node, Knowstr should use the snapshot attached to that node's `basedOn` edge. Inheriting a snapshot from an ancestor/root is allowed only when it explicitly represents the same copied source baseline for the descendant edge.

### 10. Voting is future work

If `knowstr_vote_id` is set, Knowstr preserves it.

Future voting aggregates should group documents by `knowstr_vote_id`, not by reused `knowstr_doc_id` values.

V1 does not need to compute voting aggregates.

## CLI commands

### `knowstr init`

```sh
knowstr init [--doc <dir>] [--relay <url> ...]
```

Explicitly creates a local Knowstr workspace/state directory.

It is required before commands that need persistent collaboration state, such as `source`, `import`, and `suggest`. It is not required for standalone `knowstr save <file>` or read-only `knowstr show`.

It should:

- create `.knowstr/profile.json`
- create `.knowstr/sources.json` or equivalent source configuration
- create `.knowstr/snapshots/` or equivalent durable snapshot storage
- optionally create or reference local key material when Nostr/relay features are enabled, e.g. `.knowstr/me.nsec`
- optionally configure a document workspace with `--doc <dir>`
- optionally configure relays with `--relay <url>`

It should not import, save, fork, suggest, or publish documents.

No other command should auto-run `init` or implicitly create `.knowstr`.

UI equivalent: first-run onboarding, workspace/state setup, source settings, optional identity/relay settings.

### `knowstr source`

```sh
knowstr source add <file-or-dir>
knowstr source list
knowstr source remove <file-or-dir>
```

Registers read-only source files/directories in an initialized workspace.

`knowstr source` requires `.knowstr` and must not create it implicitly. If no workspace exists, it should fail and tell the user to run `knowstr init` first.

A source can be:

- a file received over FTP/email
- a shared directory
- a Git checkout
- a Dropbox/shared-drive folder
- a future Nostr-backed cache/export
- my own old/archive workspace

`source add` should not copy, fork, rewrite, or delete the source. Configured source paths should be excluded from `knowstr save`, even if physically inside the repo directory.

UI equivalent: “Shared Sources” settings.

### `knowstr show`

```sh
knowstr show <address>
```

Renders a visible document or node as markdown.

Supported address forms should include current browser routes:

```sh
knowstr show knowstr.com/d/<author>/<doc-id>
knowstr show knowstr.com/r/<node-id>
```

Current URL meanings:

- `/d/<author>/<doc-id>` = document container
- `/r/<node-id>` = node/subtree rooted at that node

`show` does not import, save, register a source, or create editable IDs. It is read/render/export.

When showing a node/subtree, output should include enough frontmatter for safe portable markdown. If the containing document has `knowstr_vote_id`, preserve it.

Example:

```sh
knowstr show knowstr.com/d/alice/kdoc_holidays > /ftp/alice/holidays.md
```

UI equivalent: open visible document/node read-only.

### `knowstr import`

```sh
knowstr import <source-file> [workspace-path]
```

Creates my editable fork from a source markdown file.

`knowstr import` requires an initialized workspace because it registers/uses sources and creates durable snapshots. It must not create `.knowstr` implicitly. If no workspace exists, it should fail and tell the user to run `knowstr init` first.

If `[workspace-path]` is omitted, Knowstr may derive a path from the source filename or document title.

It should:

- read the source markdown file
- register the source file as a source, unless already covered by a source directory
- create an immutable snapshot of the source as seen now
- create a new `knowstr_doc_id`
- mint new local UUID node IDs
- copy visible content and tree structure
- for source nodes with IDs, write `basedOn="<source-node-id>"`
- write `snapshot="<snapshot-id>"` for every node with `basedOn`
- preserve `knowstr_vote_id` if set
- write the result to the editable workspace path

If the source has no Knowstr IDs, import still works, but it cannot preserve node-level lineage. It creates an independent local document unless another matching strategy is explicitly chosen.

UI equivalent: “Import/Fork source into my workspace”.

### `knowstr save`

```sh
knowstr save [--config <path>] [file-or-dir ...]
```

Normalizes markdown as Knowstr-compatible markdown.

With explicit paths, `save` can run in standalone mode, even outside a Knowstr workspace:

```sh
knowstr save notes.md
knowstr save docs/a.md docs/b.md
```

Standalone path mode should:

- scan only the explicit files/directories given on the command line
- assign missing `knowstr_doc_id` values
- assign missing UUID node IDs
- preserve existing `basedOn`, `snapshot`, and `knowstr_vote_id`
- reject duplicate document IDs within the explicit file set
- reject duplicate node IDs within the explicit file set
- reject malformed IDs/lineage where possible
- not read or write source configuration
- not create snapshots
- not create `.knowstr`

With no explicit paths, `save` is workspace mode and requires an initialized workspace. Workspace mode should:

- scan workspace markdown, excluding `.knowstr`, ignored paths, and configured sources
- assign missing `knowstr_doc_id` values
- assign missing UUID node IDs
- preserve existing `basedOn`, `snapshot`, and `knowstr_vote_id`
- reject duplicate document IDs in the editable workspace
- reject duplicate node IDs in the editable workspace
- reject malformed IDs/lineage where possible

`save` is not for ingesting other people’s files. Use `source add` for read-only input and `import` for editable forks. `save` never creates a workspace implicitly; run `knowstr init` first for workspace mode.

UI equivalent: save/normalize/preflight current document set or workspace.

### `knowstr suggest`

```sh
knowstr suggest [--dry-run] [--json]
```

Reads configured sources and derives suggestions for my editable workspace.

`knowstr suggest` requires an initialized workspace with source configuration. It must not create `.knowstr` implicitly. If no workspace exists, it should fail and tell the user to run `knowstr init` first.

It should:

- read all configured sources
- keep sources read-only
- never rewrite, delete, clear, or move source files
- compare source lineage/IDs against my local workspace graph
- find additions/variants relevant to my documents
- derive suggestions as local `(?)` overlays/proposals
- suppress repeated suggestions from existing local graph state and node-centric diffs, not from a source-run log
- never insert source nodes directly as my editable nodes
- when a suggestion is accepted/copied, mint local node IDs
- when a suggestion is accepted/copied, write `basedOn` to the source node ID
- when a suggestion is accepted/copied, write a node-centric `snapshot` baseline for that lineage edge
- not create new snapshots during ordinary suggestion computation
- use existing node-centric snapshots from source lineage where available to compute three-way diffs
- preserve `knowstr_vote_id` when relevant
- print a CLI summary of found/already-known/conflicting suggestions
- not write `knowstr_log.md` by default

Example output:

```text
Found 1 suggestion:
  holidays.md: Holiday Destinations <- Kroatia from /ftp/bob/holidays.md
Skipped 2 already-known nodes.
0 conflicts.
```

UI equivalent: “Show suggestions from sources”.

### Removed legacy command: `knowstr apply`

The old `knowstr apply` / `./inbox` workflow is incompatible with this model and should be deleted, not repaired.

It is wrong because it:

- treats incoming files as a mutable staging area instead of declared read-only sources
- depends on shared concrete node IDs to find insertion points
- may preserve or insert source node IDs directly into my editable workspace
- clears/deletes inbox files after applying them
- writes `knowstr_log.md` as part of the merge flow
- creates materialized `(?)` nodes without the required local IDs, `basedOn` provenance, and node-centric `snapshot` baselines

The replacements are:

- `knowstr source add <file-or-dir>` for read-only inputs
- `knowstr import <source-file> [workspace-path]` for editable forks
- `knowstr suggest` for local suggestion overlays derived from sources

There should be no v2 command that silently ingests other people's markdown into my graph. Crossing from source to workspace must always be explicit as `import` or as accepting/copying a derived suggestion. Ordinary `suggest` only derives/displays proposals.

### Future convenience: `knowstr fork`

`knowstr fork <address>` is not required for v1.

It may later become a convenience wrapper around:

```sh
knowstr show <address> > temp.md
knowstr import temp.md <workspace-path>
```

Because it uses `import`, it requires an initialized workspace and must not create `.knowstr` implicitly. It must not introduce different graph semantics from import.

### Future: `knowstr aggregate`

```sh
knowstr aggregate <vote-id>
```

Future command, not v1.

Computes a voting/ranking aggregate over visible documents with the same `knowstr_vote_id`.

## User workflows

### Workflow 0: Standalone markdown normalization

A user can normalize one markdown file without creating a Knowstr workspace:

```sh
knowstr save holidays.md
```

This may add `knowstr_doc_id` and node IDs to `holidays.md`, but it does not create `.knowstr`, does not track sources, and does not create snapshots.

### Workflow 1: Alice creates and shares a document

Alice explicitly creates a workspace:

```sh
knowstr init
```

Then she creates `holidays.md` in her workspace:

```md
# Holiday Destinations
- Spain
- Italy
```

She runs:

```sh
knowstr save
```

Knowstr normalizes it:

```md
---
knowstr_doc_id: kdoc_alice_holidays_8f6b
---

# Holiday Destinations <!-- id:uuid-a1 -->
- Spain <!-- id:uuid-a2 -->
- Italy <!-- id:uuid-a3 -->
```

Alice shares it by any transport:

```sh
cp holidays.md /ftp/alice/holidays.md
```

### Workflow 2: Bob only wants to observe Alice’s document

Bob initializes a workspace and adds Alice’s file as a source:

```sh
knowstr init
knowstr source add /ftp/alice/holidays.md
knowstr suggest --dry-run
```

If Bob has no local related document, Knowstr may report that Alice’s document is visible as a source but there is no local target for suggestions.

### Workflow 3: Bob wants to edit Alice’s document

Bob initializes a workspace if needed, then imports Alice’s source into it:

```sh
knowstr init  # if not already initialized
knowstr import /ftp/alice/holidays.md holidays.md
```

Bob gets his own editable fork:

```md
---
knowstr_doc_id: kdoc_bob_holidays_32ad
---

# Holiday Destinations <!-- id:uuid-b1 basedOn="uuid-a1" snapshot="snap_sha256_alice_holidays" -->
- Spain <!-- id:uuid-b2 basedOn="uuid-a2" snapshot="snap_sha256_alice_holidays" -->
- Italy <!-- id:uuid-b3 basedOn="uuid-a3" snapshot="snap_sha256_alice_holidays" -->
```

Bob edits:

```md
- Kroatia <!-- id:uuid-b4 -->
```

Then saves and shares his file:

```sh
knowstr save
cp holidays.md /ftp/bob/holidays.md
```

### Workflow 4: Alice gets Bob’s changes as suggestions

Alice does not copy Bob’s file into her workspace. She adds it as a source:

```sh
knowstr source add /ftp/bob/holidays.md
knowstr suggest
```

Knowstr derives a local suggestion overlay for Alice’s document:

```md
# Holiday Destinations <!-- id:uuid-a1 -->
- Spain <!-- id:uuid-a2 -->
- Italy <!-- id:uuid-a3 -->
- (?) Kroatia <!-- virtual suggestion from uuid-b4; not yet a local node -->
```

Alice can later accept/copy it. That creates a local node with a lineage edge back to Bob’s source node and a snapshot of Bob’s source state at accept time:

```md
- Kroatia <!-- id:uuid-a9 basedOn="uuid-b4" snapshot="snap_sha256_bob_holidays_at_accept" -->
```

### Workflow 5: External shared mutable markdown repo

A team can also maintain a shared markdown directory or Git repo:

```text
shared-repo/
  locations.md
```

This is external collaboration, not Knowstr-managed collaboration. Several people may edit the shared repo directly using Git/FTP/shared-drive conflict resolution. Knowstr does not own locking, conflict resolution, permissions, or commit/merge policy for that repo.

Each user can consume the shared repo as a read-only source from an initialized workspace:

```sh
knowstr init
knowstr source add ../shared-repo
knowstr suggest
```

This allows external shared markdown and personal Knowstr workspaces to coexist:

- the shared repo handles simultaneous document edits outside Knowstr
- Knowstr treats the shared repo as read-only input
- `knowstr save` must not rewrite files in the configured source
- each user decides what to import or suggest into their own graph
- contributing back to the shared repo is done by the external tool/process, not by `suggest`

## Safety invariants

- Workspace/source declaration decides editability.
- `.knowstr` is created only by explicit `knowstr init`, never implicitly.
- Standalone `knowstr save <file-or-dir ...>` may normalize markdown without a workspace.
- Knowstr never rewrites configured sources.
- Knowstr does not use an `apply`/`inbox` shortcut to ingest other people's markdown.
- `import` creates editable forks explicitly.
- `suggest` derives local `(?)` suggestion overlays from diffs.
- Accepting/copying suggestions creates local nodes explicitly.
- Source nodes are never inserted directly as my editable nodes.
- Documents have identity but not lineage.
- Nodes use `basedOn` for provenance.
- `snapshot` is immutable and created by import/fork/copy/accept, not by ordinary suggestion computation.
- `snapshot` lookup is node-centric, not root/document-centric.
- `knowstr_doc_id` is not a voting scope.
- `knowstr_vote_id`, if set, is preserved.
- Transport security, access control, merge conflicts, and signatures are handled outside the core graph model.
