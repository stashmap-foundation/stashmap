# Knowstr collaboration model v3

Knowstr is a markdown-first graph editor. Users think in small text blocks, arrange them into documents, link them into a graph, and keep the underlying files readable and editable as normal markdown.

The collaboration problem is not shared mutable editing. In an agent-centric world, every person has their own second brain, with their own graph, structure, priorities, and agents. Collaboration should let people work on the same question, document, or subtree without giving anyone the ability to overwrite someone else's concrete graph entities.

The model is three rules:

> 1. **Anything you can see, you can read.** Visibility comes from joining: a shared folder, a person you follow, a link you open, a group.
> 2. **Anything you edit becomes yours.** There are no read-only error walls. Editing someone else's document transparently creates your own copy, with lineage back to the original. The original is never touched.
> 3. **Differences become suggestions.** Wherever someone else's version shares lineage with your nodes, the difference renders as a `(?)` suggestion in your view. Accept what you want, ignore the rest.

It looks and feels like one common document — everyone sees a merged view — but every write goes to the writer's own layer. Nobody can overwrite anyone else's concrete entities, by construction rather than by configuration.

This is not Google Docs and not shared mutable node IDs. The closest familiar models are Google Docs suggestion mode (everyone but the owner is always suggesting) and Git (fork, status, diff, accept) — users bring the mental model with them.

## Core capabilities

The model is transport-agnostic. It needs exactly three capabilities, and each transport provides them with whatever it natively has:

| Capability | Filesystem / CLI | Web / Nostr |
| --- | --- | --- |
| **Visibility** — which documents of others you can see | joined folders | people you follow, opened share links, groups (future) |
| **Ownership** — whose document it is | `author` in frontmatter | the event signature |
| **Lineage** — what a copy came from, with a baseline | `basedOn` + `snapshot` in node comments, snapshots in `.knowstr/snapshots/` | `basedOn` + immutable snapshot events |

Ownership lives in the document, not in its location, and Knowstr imposes no folder structure. The only configuration in the entire model is visibility: which folders/people/groups you have joined.

### 1. Ownership decides editability

Every Knowstr document carries its owner: `author` frontmatter on the filesystem, the signing key on Nostr. Knowstr only ever writes documents you own. Foreign-owned documents are readable everywhere and writable nowhere — editing one forks it (rule 2).

Ownership metadata is not access control. Real permissions belong to the transport: filesystem rights, Git, sync tooling, relay policy, signatures. Ownership decides what *Knowstr* will write, and that guarantee is unconditional: Knowstr never rewrites a foreign-owned document, no matter where it sits.

### 2. Editing forks: copies with lineage

Crossing from someone else's document into your graph happens by editing it, and the result is always a fork:

- a fresh `knowstr_doc_id` — the copy is a new document container;
- your ownership;
- fresh local node IDs (UUIDs);
- `basedOn` on each copied node, pointing at the original node ID;
- a `snapshot` — an immutable record of the original as you copied it, the baseline for later diffs.

Foreign node IDs never enter your editable graph. `basedOn` is provenance, not identity.

In the app, the fork is transparent: you touch a foreign document, your copy is created, your edits land there. On the filesystem, the fork happens at `knowstr save`: a foreign-authored file sitting in your own tree can only mean you copied it there to make it yours, so `save` performs the fork bookkeeping and reports it. `cp` is the consent.

### 3. Suggestions are a computed view

A suggestion is the rendered difference between your node and its lineage relatives, computed from a three-way diff:

```text
base   = the snapshot recorded when your lineage edge was created
theirs = the original author's node now
mine   = your node now
```

Because suggestions are recomputed from graph state and lineage, there is no run log, no suggestion inbox, and no tombstones. Ignoring a suggestion costs nothing; it simply remains visible until the upstream reverts or you accept. Accepting mints a local node with `basedOn` and a fresh snapshot baseline for that edge, so it is never re-suggested.

Suggestions are never stored as data in your documents. They are a view:

- the app renders them live as `(?)` rows in the tree;
- the CLI prints them on request, or materializes them temporarily into your files (see below).

## Documents and nodes

- A document is a markdown container for one or more root nodes, identified by `knowstr_doc_id`. Documents have identity but not lineage; nodes have lineage.
- Node IDs are UUIDs, globally unique in practice. Explicit safe IDs from markdown are preserved exactly.
- `basedOn` and `snapshot` belong together: they describe a node-level lineage edge and the exact source state used as the baseline. Snapshot lookup is node-centric, never inherited from a root/document unless it explicitly represents the same copied baseline.
- Snapshots are immutable, created when a lineage edge is created (fork/accept), never by ordinary suggestion computation. Snapshot IDs may be content hashes. Durable storage: `.knowstr/snapshots/<snapshot-id>.md` for filesystem workspaces, immutable events for Nostr.
- `knowstr_vote_id`, if set, is preserved. Voting aggregates are future work.
- A plain markdown file with no Knowstr metadata is valid; `knowstr save` may add frontmatter, document IDs, and node IDs.

## Filesystem + CLI

### Spaces are plain folders

A space is any folder you join — an FTP drop, a Dropbox share, a Git checkout, a team repo with its own layout. Knowstr imposes no structure on it; ownership is read from the documents, not from paths. Per-author subfolders are a nice convention for humans, never a requirement.

```sh
knowstr join ../shared-space
```

Files inside joined folders are never claimed or rewritten by Knowstr. The transport (Git, sync, permissions) governs who may write there; Knowstr only ever writes your own files.

### Forking from the CLI

```sh
cp shared-space/alice/houses.md .
knowstr save
```

Before, the copy still carries alice's metadata — that is the signal, and the provenance:

```md
---
knowstr_doc_id: kdoc_8f6b
author: alice
---
# Houses <!-- id:a1 -->
- Brick house <!-- id:a2 -->
```

`knowstr save` sees a foreign-authored file in your workspace and forks it:

```md
---
knowstr_doc_id: kdoc_3c2e
author: you
---
# Houses <!-- id:u1 basedOn="a1" snapshot="snap_sha256_…" -->
- Brick house <!-- id:u2 basedOn="a2" snapshot="snap_sha256_…" -->
```

```text
houses.md: forked from alice (2 nodes linked, snapshot created)
```

Alice's original is untouched. Nothing is silent: `save` reports every fork it performs.

The claiming rules of `save` in one place:

- your own files: normalized as always (IDs assigned, lineage metadata preserved);
- unowned plain markdown in your workspace: claimed as yours (ownership stamped along with IDs);
- foreign-authored files in your workspace: forked, with lineage and snapshot, reported;
- anything inside a joined folder: never touched.

### Suggestions in the terminal and in the editor

`knowstr status` computes suggestions on request:

```text
$ knowstr status
houses.md (based on alice):
  (?) Wooden house                   new under "Houses"
  (?) Brick house -> "Stone house"   alice edited, your copy unchanged
2 suggestions.
```

`knowstr accept houses.md:1` takes one. `--json` on `status`/`diff` is the agent/LLM surface.

For editor-centric users, the file itself is the interface:

```sh
knowstr status --write
```

materializes suggestions as marked proposal rows in your file. A suggestion row is an ordinary node line with `basedOn` but no `id`, carrying the `(?)` marker:

```md
# Houses <!-- id:u1 basedOn="a1" -->
- Brick house <!-- id:u2 basedOn="a2" -->
- (?) Wooden house <!-- basedOn="a3" -->
```

Your editor is the accept button: remove the `(?)` marker to accept, delete the line (or leave it marked) to pass. The next `knowstr save` needs no special accept logic — an unmarked row with `basedOn` and a missing `id` goes through ordinary normalization: the ID is minted, `basedOn` is preserved, and a snapshot baseline is created for the new lineage edge. Rows still marked `(?)` are stripped, because suggestions are a view. The origin author is recoverable from `basedOn` (scoped-ref form where a bare ID would be ambiguous across sources). The clean file is canonical; materialized markup is a temporary working view, and `save` always returns the file to canonical state.

### CLI commands

| Command | Purpose |
| --- | --- |
| `knowstr init` | create local state and identity, once; required for stateful commands, never created implicitly |
| `knowstr join <folder>` | add a folder to your visibility; `list`/`remove` to manage |
| `knowstr save [file …]` | normalize markdown; stamp IDs and ownership; perform fork bookkeeping; resolve materialized suggestion markup. Standalone explicit-path mode works without a workspace and stays stateless |
| `knowstr status [--write] [--json]` | compute suggestions; `--write` materializes them into your files |
| `knowstr diff <doc> [--json]` | show a suggestion in detail |
| `knowstr accept <ref>` | take a suggestion into your document |
| `knowstr show <address>` | render a visible document/node as portable markdown; read-only |

No command ingests other people's markdown into your graph; the only crossing is the fork performed by `save` or by accepting a suggestion.

## Web + Nostr

The same model with the web's native materials, and no folders anywhere:

- **Visibility**: people you follow, share links you open (`/d/<author>/<doc-id>`, `/r/<node-id>`), and later groups — a membership-scoped visibility set (token management out of scope).
- **Ownership**: the event signature. Stronger than frontmatter, same role.
- **Fork-on-write**: opening a foreign document shows it read-only; touching it creates your copy with `basedOn` and a snapshot event, and your edits land there. A first-edit affordance ("this creates your copy") keeps the fork explicit without ceremony.
- **Suggestions**: rendered live as `(?)` rows wherever lineage relatives differ — no status command, no refresh.
- **Snapshots**: immutable Nostr events, cached locally; filesystem-backed storage when running in Electron.

App equivalents of the CLI surface: onboarding = `init`; Follow / Open link / Join group = `join`; continuous editing = `save`; live `(?)` overlays = `status`; expanding a `(?)` row = `diff`; the ✓ on a row = `accept`; read-only document view = `show`.

## Workflows

### Alice shares, investors respond

Alice shares `locations.md` into the investors' space (folder or group). Investors open it and put relevance markers on locations or add new ones — each is transparently writing their own fork. Alice's view of her document shows attributed `(?)` overlays: who weighted what, who proposed Montenegro. She accepts what she finds valuable. Nobody ran a setup command; the result is permanent, living documents rather than a forum thread.

### The entrepreneur round-trip

Carol's LLM compiles a task document from her private graph and sends it to an employee. The employee opens it and edits — their copy, lineage preserved through the node IDs the file carries — and sends it back over any transport. Carol opens the returned file; the employee's changes appear as suggestions against her graph, and her LLM consumes `knowstr status --json` / `knowstr diff --json` to integrate them. The snapshot baseline was created by her own export, automatically.

### The student club

The club shares excerpts in a folder or group. Each student's annotations are their own layer on the common lineage. Bob sees fellow students' annotations as `(?)` suggestions next to his own notes — valuable input, never replacing his own work, non-destructive by construction.

### Opsec club

Members of a token-gated group see everyone's content; each member's own arrangement is their own graph. This is the model working natively: shared visibility, personal layers, no shared mutable state.

### External shared repos still work

A team may keep editing a common markdown repo directly through Git — that is external collaboration, governed by Git. Any member joins the repo as a folder; its documents are visible, foreign-owned, and fork-on-edit like everything else. Knowstr never writes there.

## Safety invariants

- Ownership, carried in the document, decides what Knowstr writes. Knowstr never writes a foreign-owned document.
- Files inside joined folders are never claimed, normalized, or rewritten.
- Crossing from foreign into mine is always a fork: fresh document ID, my ownership, minted node IDs, `basedOn`, snapshot. Foreign node IDs never become my editable nodes.
- Forks are never silent: the app shows a first-edit affordance; `save` reports every fork.
- Suggestions are a computed view, never stored data; ordinary suggestion computation creates no snapshots and mutates nothing.
- Materialized `(?)` markup is temporary; `save` returns files to canonical state.
- Snapshots are immutable, node-centric baselines created only when lineage edges are created.
- Documents have identity but not lineage; nodes carry lineage through `basedOn`.
- `knowstr_doc_id` is not a voting scope; `knowstr_vote_id`, if set, is preserved.
- `.knowstr` is created only by explicit `knowstr init`. Standalone `knowstr save <paths>` stays stateless.
- Transport security, access control, merge conflicts, and signatures are handled outside the core graph model.

## Future work

- **Groups** as a first-class visibility scope on Nostr (membership/token management out of scope).
- **Voting aggregates** over `knowstr_vote_id`.
- **Permanent dismissal** of suggestions, if ignoring proves insufficient in practice.
- **Read-only flags** for own folders (e.g. consuming your own archive without claiming it).
- **`knowstr aggregate`** and richer agent surfaces over `status --json`.
