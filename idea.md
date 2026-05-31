# Knowstr collaboration model v2

Knowstr is a markdown-first graph editor. Users think in small text blocks, arrange them into documents, link them into a graph, and keep the underlying files readable and editable as normal markdown.

The collaboration problem is not shared mutable editing. In an agent-centric world, every person has their own second brain, with their own graph, structure, priorities, and agents. Collaboration should let people work on the same question, document, or subtree without giving anyone the ability to overwrite someone else’s concrete graph entities.

The model is:

> A Knowstr workspace is my editable graph. Sources are read-only inputs. Importing creates my editable fork from a source. Suggesting reads sources and adds local `(?)` suggestion nodes into my graph. Documents are markdown containers. Nodes carry lineage through `basedOn` and `snapshot`.

This is not Google Docs. It is not shared mutable node IDs. But it can still consume shared mutable markdown directories, Git repos, FTP folders, or Nostr documents as sources.

## Core principles

### 1. Workspace vs sources

The main distinction is not “mine vs foreign author”. The main distinction is declared by location/configuration:

```text
workspace = editable / part of my graph / saved by knowstr save
sources   = read-only input / used by knowstr suggest
```

A Knowstr repo/workspace is created with:

```sh
knowstr init
```

Additional read-only inputs are declared with:

```sh
knowstr source add <file-or-dir>
```

A source may be authored by someone else, by me, by a shared group, or by no explicit author at all. Knowstr does not use author metadata to decide who is allowed to edit. Filesystem, Git, FTP, Nostr signatures, or another transport decide that.

Knowstr only follows this rule:

- workspace files may be rewritten by Knowstr commands such as `save`, `import`, and `suggest`
- source files are never rewritten by Knowstr

### 2. Plain markdown remains valid

A markdown file with no Knowstr metadata is valid:

```md
# Holiday Destinations
- Spain
- Italy
```

When saved in the workspace, Knowstr may add frontmatter, document IDs, and node IDs.

### 3. Node IDs are UUIDs

New Knowstr node IDs should be UUID-like and globally unique in practice:

```md
- Spain <!-- id:550e8400-e29b-41d4-a716-446655440000 -->
```

Because IDs are UUIDs, `knowstr_author` is not needed for collision avoidance. It is optional provenance/attribution metadata, not an edit permission mechanism.

### 4. Documents are containers, not lineage

A document is a markdown container for one or more root nodes.

`knowstr_doc_id` identifies a concrete document container. It is fresh/random and should not be reused to mean “same collaboration”. A whole-document import/fork creates a new `knowstr_doc_id`.

Documents do not have lineage. Nodes do.

```text
knowstr_doc_id = concrete document container ID
basedOn        = node provenance
snapshot       = immutable fork-time/source baseline
knowstr_vote_id = optional future voting scope
```

### 5. Import creates a fork

Import is the explicit operation that crosses from source into my graph:

```text
source document -> my workspace document
```

Import creates new local node IDs, points them to source node IDs with `basedOn`, creates a `snapshot`, and writes an editable workspace file.

### 6. Suggest adds local suggestion nodes

Suggest is the explicit operation that crosses source variants into my graph as suggestions:

```text
source node -> my local (?) suggestion node
```

A suggestion node is mine. It gets my local node ID. It points back to the source node with `basedOn` and `snapshot`.

Example:

```md
- (?) Kroatia <!-- id:alice-new-uuid basedOn="bob-source-uuid" snapshot="snap_sha256_..." -->
```

The source file is untouched.

### 8. Snapshots are immutable baselines

A snapshot records the source markdown as seen when importing or suggesting.

- created by the importer/suggester
- immutable
- can be a hash of raw source markdown
- local CLI/desktop storage: `.knowstr/snapshots/<snapshot-id>.md`
- browser/Nostr storage: immutable Nostr snapshot events plus IndexedDB cache

`snapshot` must not point only to a mutable source path or current document address.

### 9. Voting is future work

If `knowstr_vote_id` is set, Knowstr preserves it.

Future voting aggregates should group documents by `knowstr_vote_id`, not by reused `knowstr_doc_id` values.

V1 does not need to compute voting aggregates.

## CLI commands

### `knowstr init`

```sh
knowstr init [--doc <dir>] [--relay <url> ...]
```

Creates a local Knowstr workspace/profile.

It should:

- create `.knowstr/profile.json`
- create or reference local key material, e.g. `.knowstr/me.nsec`
- set my local identity
- optionally configure a document workspace with `--doc <dir>`
- optionally configure relays with `--relay <url>`

It should not import, save, fork, suggest, or publish documents.

UI equivalent: first-run onboarding, identity setup, workspace picker, relay settings.

### `knowstr source`

```sh
knowstr source add <file-or-dir>
knowstr source list
knowstr source remove <file-or-dir>
```

Registers read-only source files/directories.

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

When showing a node/subtree, output should include enough frontmatter for safe portable markdown. If `knowstr_author` is known, include it. If the containing document has `knowstr_vote_id`, preserve it.

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

If `[workspace-path]` is omitted, Knowstr may derive a path from the source filename or document title.

It should:

- read the source markdown file
- register the source file as a source, unless already covered by a source directory
- create an immutable snapshot of the source as seen now
- create a new `knowstr_doc_id`
- set `knowstr_author` to me if Knowstr writes author metadata
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
knowstr save [--config <path>]
```

Normalizes and commits the editable workspace as my graph.

It should:

- scan workspace markdown, excluding `.knowstr`, ignored paths, and configured sources
- assign missing `knowstr_doc_id` values
- assign missing UUID node IDs
- optionally add `knowstr_author: <me>` to workspace files that lack author provenance
- preserve existing `basedOn`, `snapshot`, and `knowstr_vote_id`
- reject duplicate document IDs in the editable workspace
- reject duplicate node IDs in the editable workspace
- reject malformed IDs/lineage where possible

`save` is not for ingesting other people’s files. Use `source add` for read-only input and `import` for editable forks.

UI equivalent: save/normalize/preflight current workspace.

### `knowstr suggest`

```sh
knowstr suggest [--dry-run] [--json]
```

Reads configured sources and adds suggestions into my editable workspace.

It should:

- read all configured sources
- keep sources read-only
- never rewrite, delete, clear, or move source files
- compare source lineage/IDs against my local workspace graph
- find additions/variants relevant to my documents
- add suggestions as my local `(?)` nodes
- mint my local node IDs
- write `basedOn` to the source node ID
- write `snapshot` to the immutable source baseline
- preserve `knowstr_vote_id` when relevant
- print a CLI summary of added/skipped/conflicting suggestions
- not write `knowstr_log.md` by default

Example output:

```text
Added 1 suggestion:
  holidays.md: Holiday Destinations <- Kroatia from /ftp/bob/holidays.md
Skipped 2 already-known nodes.
0 conflicts.
```

UI equivalent: “Add suggestions from sources”.

### Future convenience: `knowstr fork`

`knowstr fork <address>` is not required for v1.

It may later become a convenience wrapper around:

```sh
knowstr show <address> > temp.md
knowstr import temp.md <workspace-path>
```

It must not introduce different graph semantics from import.

### Future: `knowstr aggregate`

```sh
knowstr aggregate <vote-id>
```

Future command, not v1.

Computes a voting/ranking aggregate over visible documents with the same `knowstr_vote_id`.

## User workflows

### Workflow 1: Alice creates and shares a document

Alice creates `holidays.md` in her workspace:

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
knowstr_author: alice
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

Bob adds Alice’s file as a source:

```sh
knowstr source add /ftp/alice/holidays.md
knowstr suggest --dry-run
```

If Bob has no local related document, Knowstr may report that Alice’s document is visible as a source but there is no local target for suggestions.

### Workflow 3: Bob wants to edit Alice’s document

Bob imports Alice’s source into his workspace:

```sh
knowstr import /ftp/alice/holidays.md holidays.md
```

Bob gets his own editable fork:

```md
---
knowstr_author: bob
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

Knowstr adds a local suggestion node to Alice’s document:

```md
# Holiday Destinations <!-- id:uuid-a1 -->
- Spain <!-- id:uuid-a2 -->
- Italy <!-- id:uuid-a3 -->
- (?) Kroatia <!-- id:uuid-a9 basedOn="uuid-b4" snapshot="snap_sha256_bob_holidays" -->
```

Alice can later accept it by editing the marker:

```md
- Kroatia <!-- id:uuid-a9 basedOn="uuid-b4" snapshot="snap_sha256_bob_holidays" -->
```

### Workflow 5: Shared mutable markdown repo

A team can also maintain a shared markdown directory or Git repo:

```text
shared-repo/
  locations.md
```

Several people may edit it directly using Git/FTP/shared drive conflict resolution. Knowstr does not own that concurrency model.

Each user can consume it as a source:

```sh
knowstr source add ../shared-repo
knowstr suggest
```

This allows shared mutable markdown and personal authored graphs to coexist:

- shared repo handles simultaneous document edits
- Knowstr treats the shared repo as read-only input
- each user decides what to import or suggest into their own graph

## Safety invariants

- Workspace/source declaration decides editability, not `knowstr_author`.
- Knowstr never rewrites configured sources.
- `import` creates editable forks explicitly.
- `suggest` creates local `(?)` suggestion nodes explicitly.
- Source nodes are never inserted directly as my editable nodes.
- Documents have identity but not lineage.
- Nodes use `basedOn` for provenance.
- `snapshot` is immutable and created by the importer/suggester.
- `knowstr_doc_id` is not a voting scope.
- `knowstr_vote_id`, if set, is preserved.
- Transport security, access control, merge conflicts, and signatures are handled outside the core graph model.
