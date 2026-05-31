# Knowstr multi-user collaboration and forking model

Knowstr is a markdown-first graph editor. Users think in small text blocks, arrange them into documents, link them into a graph, and keep the underlying files readable and editable as normal markdown.

The collaboration problem is not shared mutable editing. In an agent-centric world, every person has their own second brain, with their own graph, structure, priorities, and agents. Collaboration should let people work on the same question, document, or subtree without giving anyone the ability to overwrite someone else’s concrete graph entities.

The model is:

> Sharing means visibility. Forking creates node lineage. Documents are markdown containers with concrete document identity, not lineage. A whole-document fork creates a new document ID. Suggestions are non-destructive overlays from visible lineage variants. Future voting uses an optional shared vote ID, not document lineage and not reused document IDs.

This is not Google Docs. It is not shared mutable node IDs. It is not a forum. It is not a one-time form submission. It is a living authored-graph model for markdown.

## Implementation priority

The first implementation should focus on:

1. safe markdown identity rules
2. owned editable nodes
3. foreign-authored markdown import/fork safety
4. whole-document, node, and subtree forks
5. node-level `basedOn` lineage
6. per-node snapshot pointers where possible
7. non-destructive suggestions from visible lineage variants

Voting must be considered so the model does not block it later, but voting aggregate computation is a future feature and should not be part of the first implementation.

## Short version

1. **Documents can be shared.**
   Sharing only means the document is published/visible. It does not grant edit rights.

2. **Users can fork documents, nodes, and subtrees.**
   Forking creates new local node IDs and `basedOn` lineage. Users can fork other users’ nodes or their own nodes.

3. **Documents do not have lineage.**
   Nodes have lineage. Documents are markdown containers.

4. **A whole-document fork creates a new `knowstr_doc_id`.**
   The fork is my own concrete document, not a second version of the source document ID.

5. **`author + knowstr_doc_id` identifies a concrete authored document container.**
   `knowstr_doc_id` is a fresh random document-id part. It is not a human slug and not the voting scope. We do not intentionally reuse raw document IDs, but the concrete identity is the author-qualified ID.

6. **Future voting uses an optional shared `knowstr_vote_id`.**
   A voting aggregate, when implemented, should group visible documents by `knowstr_vote_id`, not by `knowstr_doc_id` and not by document lineage.

7. **Suggestions are lineage-scoped.**
   Additions and renames in visible forks can appear as `(?)` overlays. Materializing a suggestion creates my own node, not an editable copy of someone else’s concrete node. Accepting a materialized local suggestion is a later local edit/stance change.

8. **Author trust is transport-specific and out of scope for the graph model.**
   In plaintext markdown, `knowstr_author` is a namespace field. Signed transports such as Nostr can verify authorship separately. For signed imports, the transport signer is the trusted author source.

## Vocabulary

### Author

The user namespace that owns concrete graph entities.

In markdown, `knowstr_author` in frontmatter namespaces local node IDs:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
title: Holiday Destinations
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

Effective concrete node IDs:

```text
alice_A1
alice_A2
```

Effective concrete document identity:

```text
alice:kdoc_8f6b1c4d2e9a
```

`knowstr_author` is the Knowstr namespace field in plain markdown. It uses a Knowstr-prefixed name so it does not collide with ordinary human-facing `author` metadata. It is not by itself cryptographic proof. Signed transports such as Nostr can verify authorship separately. For Nostr, the event pubkey/npub is the trusted author source; embedded markdown `knowstr_author` must match it or be rejected/normalized. The trust rule belongs to the transport and is out of scope for this core graph model.

### Document

A markdown materialization of one or more root nodes.

A document is owned by one author and has one `knowstr_doc_id`.

Documents are important because markdown files are the editing interface. File paths can change without changing document identity.

Documents do not have lineage. A document can contain nodes with lineage, but the document itself is only a container.

### `knowstr_doc_id`

The document-id part of a concrete document identity.

It should be fresh and random, for example:

```text
kdoc_8f6b1c4d2e9a
```

It is not a title and not a slug. Human names belong in `title` or `slug`.

The raw `knowstr_doc_id` alone is not the full identity. `knowstr_doc_id` identifies a concrete authored document container together with `author`:

```text
concrete document = author + knowstr_doc_id
```

A whole-document fork creates a new `knowstr_doc_id`. Reusing the source document ID is not how collaboration works, even though concrete document identity is author-qualified.

### `knowstr_vote_id` / vote ID

An optional future voting scope ID.

If voting aggregates are implemented later, visible documents that participate in the same vote can share the same `knowstr_vote_id` while still having distinct concrete document identities and normally fresh `knowstr_doc_id` values.

Example:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_locations_8f6b1c4d2e9a
knowstr_vote_id: vote_locations_51c0d8a5b923
title: Moving Village Locations
---
```

The important separation is:

```text
concrete document identity = author + knowstr_doc_id
future voting scope        = knowstr_vote_id
node provenance            = basedOn
fork-time baseline         = snapshot
```

The first implementation does not need to compute voting aggregates. It should only avoid making choices that would block this later. In practice that means: do not use `knowstr_doc_id` as a shared voting scope, and always preserve `knowstr_vote_id` when it is set. Other unknown/future frontmatter should also be preserved when safely normalizing markdown.

### Concrete node ID

A concrete node ID is an editable ownership ID.

The concrete identity is `author + local node id`, for example `alice_A1`. Local node IDs should be generated fresh and not intentionally reused, but the author-qualified concrete node ID is the identity. Other users must not reuse someone else’s concrete node ID as their editable node ID.

### `basedOn`

A node-level lineage pointer.

It says: this concrete node was forked from that concrete source node.

Documents do not have `basedOn`. Nodes do.

### `snapshot`

A node-level baseline pointer.

It says: this is the source version that was seen at fork time.

The snapshot is created at fork time by the forker/importer, not by the source author. It must refer to an immutable baseline: content-addressed, event-ID-based, or otherwise immutable. A mutable document address such as `author + knowstr_doc_id` is not enough.

`basedOn` tells Knowstr which source node. `snapshot` tells Knowstr where to find the immutable fork-time version of that source node for precise diffs.

## Sharing means visibility

Sharing a document means publishing it or otherwise making it visible to someone.

Sharing does not create a shared mutable object.

If Alice shares a document:

- Bob can read it.
- Bob can fork it.
- Bob can use it as context.
- Bob cannot save edits into Alice’s concrete nodes.
- Alice’s signed nodes are never overwritten by Bob.

Visibility is the input for collaboration:

- visible documents can be read
- visible nodes can be forked
- visible lineage variants can generate suggestions
- future voting aggregates can use visible documents that share a `knowstr_vote_id`

Private documents and private forks can exist. They do not affect other users until they become visible.

## Documents have identity, not lineage

Documents do not have `basedOn` chains.

There is no document-level lineage.

Instead:

- documents have `author + knowstr_doc_id`
- nodes have `basedOn` lineage
- future voting aggregates use `knowstr_vote_id`
- suggestions use node lineage

This separation is important.

```text
author + knowstr_doc_id = concrete document container identity
knowstr_vote_id = optional future voting aggregate scope
basedOn         = node provenance and suggestion/diff lineage
snapshot        = fork-time baseline for a basedOn node
```

A document is a markdown-compatible container. The data that matter for collaboration are the authored graph nodes inside it.

## Document identity

A document looks like:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_8f6b1c4d2e9a
title: Holiday Destinations
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
- Italy <!-- id:A3 -->
```

The concrete document is:

```text
alice:kdoc_alice_8f6b1c4d2e9a
```

If Bob forks Alice’s whole document, Bob creates a separate concrete document with a new document ID:

```text
alice:kdoc_alice_8f6b1c4d2e9a
bob:kdoc_bob_32ad0c9f71b4
```

Bob’s document is not a later version of Alice’s document. It is Bob’s own markdown container containing Bob-owned nodes that point to Alice’s nodes through `basedOn`.

There can be only one current document with the same `author + knowstr_doc_id`.

On Nostr, the latest replaceable document event for that author and `d` tag wins.

On the filesystem, `knowstr save` must reject duplicate local documents with the same concrete document identity. Raw `knowstr_doc_id` values should be generated fresh and not intentionally reused, so duplicate raw document IDs in one editable workspace are suspicious. They may be allowed across different authors only because the real key is `author + knowstr_doc_id`; they must not be treated as collaboration state or a shared document.

## Forking creates node lineage

Forking is the operation that creates editable local copies with provenance.

A fork can start from:

- a whole document
- a document root
- a node
- a subtree

The source can be:

- another user’s graph
- my own graph

Forking means:

- mint a new document ID when creating a new document
- mint new local node IDs
- copy content and structure
- write `basedOn` pointers to the immediate concrete source nodes
- create an immutable fork-time source snapshot as the forker/importer where possible
- write `snapshot` pointers to that fork-time source baseline where possible
- allow the fork to diverge freely

Forking does not preserve another user’s concrete node IDs as editable IDs.

## Whole-document fork

A whole-document fork creates my own authored document with a new `knowstr_doc_id`.

Alice publishes:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_8f6b1c4d2e9a
title: Holiday Destinations
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

Bob forks the whole document:

```md
---
knowstr_author: bob
knowstr_doc_id: kdoc_bob_32ad0c9f71b4
title: Holiday Destinations
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
```

Bob’s nodes do not conflict with Alice’s nodes because they have different concrete IDs:

```text
alice_A1 != bob_B1
alice_A2 != bob_B2
```

Lineage connects them:

```text
bob_B1 basedOn alice_A1
bob_B2 basedOn alice_A2
```

Bob can now reorder, rename, add, remove, and mark relevance in his own document.

Alice’s nodes are unchanged.

If Alice’s document is a future voting document, it can contain an optional shared vote ID:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_locations_8f6b1c4d2e9a
knowstr_vote_id: vote_locations_51c0d8a5b923
title: Moving Village Locations
---
```

Bob’s fork would still get a new `knowstr_doc_id`, and if the source document has `knowstr_vote_id`, the fork preserves it:

```md
---
knowstr_author: bob
knowstr_doc_id: kdoc_bob_locations_32ad0c9f71b4
knowstr_vote_id: vote_locations_51c0d8a5b923
title: Moving Village Locations
---
```

The shared vote ID is a future aggregate scope. It is not document lineage.

## Node and subtree fork into another document

A node or subtree can be forked into an existing document.

Example: Bob forks Alice’s `Holiday Destinations` subtree into his own private travel document.

```md
---
knowstr_author: bob
knowstr_doc_id: kdoc_bob_trips_32ad0c9f71b4
title: Trips with my wife
---

# Trips with my wife <!-- id:T1 -->

- Holiday Destinations <!-- id:B7 basedOn="alice_A1" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
  - Spain <!-- id:B8 basedOn="alice_A2" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
```

This preserves node lineage, but it does not make Bob’s travel document part of any future vote unless the target document explicitly has the relevant `knowstr_vote_id`.

Therefore:

- whole-document fork creates a new `knowstr_doc_id`
- node/subtree fork into an existing document keeps the target document’s `knowstr_doc_id`
- suggestions and diffs follow node lineage
- future voting aggregates follow `knowstr_vote_id`, not document ID and not node lineage

## Concrete node IDs vs lineage

Concrete node IDs are local editable ownership IDs.

Alice may have:

```text
alice_A1 = Holiday Destinations
alice_A2 = Spain
alice_A3 = Barcelona
```

Bob’s editable fork is:

```text
bob_B1 basedOn alice_A1 = Holiday Destinations
bob_B2 basedOn alice_A2 = Spain
bob_B3 basedOn alice_A3 = Barcelona
```

Carol’s editable fork is:

```text
carol_C1 basedOn alice_A1 = Holiday Destinations
carol_C2 basedOn alice_A2 = Spain
carol_C3 basedOn alice_A3 = Barcelona
```

Concrete identity differs:

```text
alice_A1 != bob_B1 != carol_C1
```

Lineage connects them:

```text
origin(alice_A1) = alice_A1
origin(bob_B1)   = alice_A1
origin(carol_C1) = alice_A1
```

Lineage is useful for:

- showing suggestions
- computing additions/removals/renames
- provenance
- comparing variants
- grouping adopted suggestions

Lineage is not document identity and not future voting scope.

## Snapshots

`basedOn` points to the source node.

`snapshot` points to the immutable source version seen at fork time.

The snapshot is made by the forker/importer during the fork. If Bob forks Alice’s document, Bob’s Knowstr client records Alice’s source as Bob saw it at that moment and gives that baseline an immutable snapshot ID.

For the first implementation, snapshots can be whole-source-document snapshots. The snapshot ID can be a hash of the raw source markdown as seen by the forker/importer at fork time. A Nostr event ID or another immutable signed/content-addressed reference is also acceptable. It must not be merely a pointer to Alice’s current mutable document address, because Alice may publish a later version.

Local CLI and desktop/Electron storage should keep snapshot payloads under `.knowstr/snapshots/`, for example `.knowstr/snapshots/<snapshot-id>.md` containing the raw markdown that was hashed. Browser/Nostr usage should publish or reference immutable snapshot events on Nostr and may cache them in IndexedDB. IndexedDB alone is only a browser cache, not the local CLI/desktop snapshot store.

Every Bob node that has `basedOn="alice_..."` can point to that same snapshot.

Example:

```md
# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
  - Barcelona <!-- id:B3 basedOn="alice_A3" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
```

The `snapshot` pointer should be written on every node that has `basedOn`, not only on the fork root.

This denormalization is intentional. If a child is later moved, copied, or separated from its parent, it still knows how to interpret its own `basedOn` pointer.

Rule:

```text
basedOn=<source-node-id> + snapshot=<immutable fork-time baseline containing that source-node-id>
```

If a snapshot is missing, the graph is still safe:

- ownership still works
- lineage still works
- suggestions can still work

What degrades is precise version diffing. The UI/CLI should fall back conservatively rather than inventing additions/deletions.

## Operation semantics

Knowstr should distinguish these operations clearly.

### Move

Move an existing node.

- same concrete node IDs
- no new `basedOn`
- no new `snapshot`

### Reference

Link to an existing node/document.

- no copied content
- no new editable node copy of the target
- no new `snapshot`

### Fork

Create a provenance-preserving editable copy.

- new concrete node IDs
- copied content and structure
- `basedOn` on copied nodes
- `snapshot` on copied nodes where possible
- source can be another user or myself

If the fork creates a new document, it also creates a new `knowstr_doc_id`.

### Duplicate as independent

Create an unrelated copy.

- new concrete node IDs
- no `basedOn`
- no `snapshot`

This is useful when I explicitly do not want provenance.

A contextual drag/copy can be a fork when I want provenance and version comparison. It can be an independent duplicate when I explicitly want a fresh unrelated copy.

## Suggestions overlay

Suggestions are computed from visible lineage variants.

They are not edits to my graph.

If Bob adds something under his fork of a node I also have, I can see Bob’s addition as a `(?)` overlay.

Alice has:

```md
# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

Bob forks and adds Portugal:

```md
# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
- Portugal <!-- id:B3 -->
```

Alice may see:

```md
# Holiday Destinations
- Spain
- (?) Portugal
```

The `(?) Portugal` row is not Alice’s concrete node. It is an overlay.

If Alice runs `knowstr suggest`, Knowstr can materialize the overlay as Alice’s own local suggestion node:

```md
- (?) Portugal <!-- id:A9 basedOn="bob_B3" snapshot="snap_sha256_bob_holiday_91de7b" -->
```

The persisted `(?)` now means “local suggestion candidate”, not Bob’s node. It is Alice-owned and editable, but still marked as unaccepted.

If Alice later accepts it, she removes or changes the suggestion marker:

```md
- Portugal <!-- id:A9 basedOn="bob_B3" snapshot="snap_sha256_bob_holiday_91de7b" -->
```

`knowstr suggest` should never insert Bob’s concrete node as Alice’s editable node.

It should create Alice’s own local suggestion node based on Bob’s node.

Suggestion principles:

- additions from visible forks can appear as `(?)` overlays
- `knowstr suggest` may materialize an overlay as my local `(?)` suggestion node
- accepting a suggestion is a later user edit/choice; acceptance removes the suggestion marker or changes it to an explicit stance
- rename/edit variants can appear as rename suggestions or variant rows
- deletions should usually stay summarized, e.g. `+5 -3`, not as scary inline deleted nodes
- pure overlay suggestions do not count as my document content
- local suggestion nodes created by `knowstr suggest` do count as my editable content, but remain marked as suggestions until I accept/edit them
- suggestions can come from visible documents with different `knowstr_doc_id` values if the nodes are connected through `basedOn` lineage
- future voting aggregates do not work that way; they are `knowstr_vote_id` scoped

## Rename and edit suggestions

When a forked node changes text, that can be shown as a rename/edit variant.

Example:

```text
alice_A2 = Spain
bob_B2 basedOn alice_A2 = Spain / Barcelona region
```

Knowstr can show Bob’s text as a rename suggestion for Alice’s corresponding node.

There is an unavoidable semantic ambiguity:

```text
bob_B2 basedOn alice_A2 = Portugal
```

This might mean Bob renamed Spain to Portugal, or it might mean Bob replaced Spain with a new idea. The model cannot fully infer intent from text alone.

For the first version:

- preserve lineage exactly as authored
- show text changes as variants/rename suggestions
- let users accept, ignore, or create independent nodes
- do not silently rewrite lineage based on guessed meaning

## Future voting aggregates

Voting aggregates are a future feature. They are not part of the first implementation.

The first implementation must only avoid blocking voting later.

A future voting aggregate should be an optional computed view over a shared `knowstr_vote_id`.

It may answer:

- What do users prefer?
- What is on top?
- What is marked relevant?
- What is marked not relevant?
- Which new items were added?
- Which arguments are common?
- Which items are controversial?

It should not be:

- a merged document
- a shared editable result
- document lineage
- computed from reused `knowstr_doc_id` values

Potential future rule:

```text
future voting aggregate scope = knowstr_vote_id
candidate input               = latest visible participating document per author
candidate ranking             = based on document order
relevance markers             = displayed as indicators/counts
node lineage                  = provenance/suggestions/diffs, not aggregate inclusion scope
```

The exact voting algorithm is intentionally open.

Open voting questions include:

- How is `knowstr_vote_id` created?
- What exact semantics make a document with `knowstr_vote_id` count as participating in a future aggregate?
- How are independently added identical candidates grouped?
- How are renamed lineage variants counted?
- How are missing candidates scored?
- Does `(x)` affect ranking or only count as an indicator?
- How are ties handled?
- How are multi-root documents aggregated?
- Is the counted input exactly “latest visible document per author”, or something more explicit?

The non-blocking constraints for v1 are:

- `author + knowstr_doc_id` is concrete document identity only
- whole-document forks create new `knowstr_doc_id` values
- optional `knowstr_vote_id` is always preserved as frontmatter when it is already set
- sibling order and relevance/argument markers must remain represented in markdown and graph data
- node lineage must remain independent from future voting inclusion

### Future voting example

Alice shares a future voting document:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_locations_8f6b1c4d2e9a
knowstr_vote_id: vote_locations_51c0d8a5b923
title: Moving Village Locations
---

# Locations <!-- id:A1 -->
- (!) Croatia <!-- id:A2 -->
  - (+) In Europe <!-- id:A3 -->
    - (+) Reachable by car for most Europeans <!-- id:A4 -->
    - (-) Highly regulated <!-- id:A5 -->
  - (+) Very affordable <!-- id:A6 -->
- Panama <!-- id:A7 -->
- Italy <!-- id:A8 -->
```

Bob forks it. Bob receives a new document ID, keeps node lineage, and preserves the vote ID because it is set:

```md
---
knowstr_author: bob
knowstr_doc_id: kdoc_bob_locations_32ad0c9f71b4
knowstr_vote_id: vote_locations_51c0d8a5b923
title: Moving Village Locations
---

# Locations <!-- id:B1 basedOn="alice_A1" snapshot="snap_sha256_alice_locations_a73d19" -->
- (!) Italy <!-- id:B8 basedOn="alice_A8" snapshot="snap_sha256_alice_locations_a73d19" -->
- Croatia <!-- id:B2 basedOn="alice_A2" snapshot="snap_sha256_alice_locations_a73d19" -->
  - (-) Highly regulated <!-- id:B5 basedOn="alice_A5" snapshot="snap_sha256_alice_locations_a73d19" -->
- (x) Panama <!-- id:B7 basedOn="alice_A7" snapshot="snap_sha256_alice_locations_a73d19" -->
- (!) Portugal <!-- id:B9 -->
```

A later aggregate could group Alice and Bob by `vote_locations_51c0d8a5b923`. Their `knowstr_doc_id` values still differ.

## Markdown `knowstr_author` namespace rule

Markdown must be safe to send over Slack, email, Git, or copy/paste.

To make this work, node `id:` comments require a Knowstr author namespace in frontmatter.

A whole document file with node IDs should have frontmatter like:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
title: Holiday Destinations
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

A node/subtree export may omit `knowstr_doc_id`, but it must still include `knowstr_author` if it contains node IDs:

```md
---
knowstr_author: alice
---

- Spain <!-- id:A2 -->
```

Effective concrete node IDs:

```text
alice_A1
alice_A2
```

Effective concrete document identity:

```text
alice:kdoc_8f6b1c4d2e9a
```

When markdown comes from a signed transport, `knowstr_author` is not taken on faith. For Nostr, Knowstr should derive or validate `knowstr_author` from the signed event pubkey/npub. If embedded `knowstr_author` frontmatter disagrees with the signer, Knowstr should reject the event as malformed or normalize `knowstr_author` to the signer before materializing markdown.

Rules:

1. **No `knowstr_author`, no IDs in the editable workspace**
   - valid draft
   - `knowstr save` adds `knowstr_author: <me>`, a fresh random `knowstr_doc_id` if missing, and local node IDs

2. **`knowstr_author == me` in the editable workspace**
   - owned editable file
   - `knowstr save` updates my graph
   - owned `knowstr_doc_id` is preserved unless an explicit new-document/import operation is requested

3. **`knowstr_author != me` in the editable workspace**
   - foreign-authored file in the wrong place
   - `knowstr save` must not treat foreign IDs as mine
   - `knowstr save` should refuse with a clear instruction to use `knowstr import <file> [path]` to create an editable fork, or `knowstr source add <file-or-dir>` to track it as read-only input
   - `knowstr save` should not silently auto-fork foreign files

4. **`knowstr_author != me` in sources**
   - valid visible foreign input
   - `knowstr suggest` reads it as read-only source material when computing suggestions
   - source files keep their original author and IDs
   - source files are not rewritten and not forked by `suggest`

5. **IDs but no `knowstr_author`**
   - invalid
   - `knowstr save` and `knowstr suggest` must refuse or ignore with a clear diagnostic

6. **Duplicate local concrete document identity**
   - invalid in the editable workspace
   - `knowstr save` must refuse or require an explicit replace/merge flow

7. **Duplicate local concrete node IDs for the same author**
   - invalid in the editable workspace
   - `knowstr save` must refuse

This keeps plain markdown transport possible while avoiding dangerous duplicate IDs.

## Editable workspace and sources

A Knowstr repo/workspace is created with `knowstr init`.

The editable workspace contains my markdown files. These files are the materialization of my authored graph. Running `knowstr save` means “normalize and commit my editable workspace”. If a foreign-authored file is placed directly in the editable workspace, `save` refuses rather than guessing whether the user wanted a fork or a read-only source.

Sources are separate read-only inputs. A source can be a single markdown file or a directory of markdown files, including files exchanged over FTP, email downloads, Git checkouts, Dropbox, or other transports. Running `knowstr suggest` reads sources, computes visible lineage variants, and adds new suggestions to my editable workspace. It does not rewrite source files and does not create my editable fork of a whole source document.

Configured source paths are not part of the editable workspace. `knowstr save` must exclude configured sources from its editable file scan, even if a source path is physically inside the repo directory.

```text
editable workspace = mine / editable / saved by knowstr save
sources            = visible others / read-only / used by knowstr suggest
```

## Foreign-authored documents import/fork

If Bob receives a whole markdown document with `knowstr_author: alice` and wants to edit it, he explicitly imports it:

```sh
knowstr import /ftp/alice/holiday-destinations.md holidays.md
```

The second path is the destination in Bob’s editable workspace. If omitted, Knowstr may derive a destination from the source filename or document title.

`knowstr import` also registers the source file as a read-only source, unless it is already covered by an existing source directory. Future `knowstr suggest` runs can then compare Alice’s source updates with Bob’s fork.

Knowstr must not import Alice’s concrete IDs as Bob’s IDs. It creates Bob’s own authored fork.

Input source:

```md
---
knowstr_author: alice
knowstr_doc_id: kdoc_alice_8f6b1c4d2e9a
title: Holiday Destinations
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
  - Barcelona <!-- id:A3 -->
```

After Bob runs `knowstr import /ftp/alice/holiday-destinations.md holidays.md`:

```md
---
knowstr_author: bob
knowstr_doc_id: kdoc_bob_32ad0c9f71b4
title: Holiday Destinations
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
  - Barcelona <!-- id:B3 basedOn="alice_A3" snapshot="snap_sha256_alice_holiday_4f8c2a" -->
```

The import/fork operation applies to every node in the document:

- register the source file as a read-only source if needed
- generate a new `knowstr_doc_id`
- rewrite `knowstr_author` to Bob
- create an immutable fork-time source snapshot as Bob saw it
- each foreign `id:X` becomes `basedOn="alice_X" snapshot="<fork-baseline>"`
- each node receives a fresh Bob-owned `id:Y`
- preserve tree structure
- preserve visible markdown content
- preserve optional `knowstr_vote_id` if it is set

If the foreign nodes already have their own `basedOn` values, Bob’s new nodes should still point to the immediate concrete source he imported, e.g. `basedOn="alice_A1"`. Full lineage can then be followed through Alice’s node if available.

If Bob already has a local fork of the same foreign source, v1 can either create a second independent document or refuse with a clear “already imported” message. This is an open UX question. It should not be solved by reusing Alice’s `knowstr_doc_id`.

### File exchange roundtrip

Alice can create and share a markdown file by any transport. Bob imports it when he wants an editable fork:

```sh
knowstr import /ftp/alice/holiday-destinations.md holidays.md
knowstr save
```

Bob edits his Bob-authored `holidays.md` and shares that file back. Alice should not copy Bob’s file into her editable workspace. She should add it as a source and ask Knowstr to add suggestions:

```sh
knowstr source add /ftp/bob/holidays.md
knowstr suggest
```

Because Bob’s nodes have `basedOn` pointers to Alice’s nodes, Alice can receive Bob’s additions, renames, and variants as local suggestions. If Alice later accepts one, she edits/removes the suggestion marker; the node already has `basedOn` pointing to Bob’s suggestion.

## CLI model

The CLI should mirror the graph model.

### `knowstr init`

Initialize a local Knowstr workspace/profile.

```sh
knowstr init [--doc <dir>] [--relay <url> ...]
```

It should not import, fork, save, publish, or otherwise mutate markdown documents.

It should create or configure:

- `.knowstr/profile.json`
- local key material, e.g. `.knowstr/me.nsec`
- my author identity, preferably npub/public-key based
- an optional document workspace via `--doc <dir>`
- optional relays via `--relay <url>`

Snapshot storage such as `.knowstr/snapshots/` can be created lazily on first fork/import rather than during init.

UI equivalent: first-run onboarding, identity creation/import, workspace/document folder selection, and relay configuration. It has no graph semantics yet.

### `knowstr source`

Manage read-only visible source files/directories.

```sh
knowstr source add <file-or-dir>
knowstr source list
knowstr source remove <file-or-dir>
```

A source is not my editable workspace. It is visible input from another author or transport. Sources can be local files, FTP-mounted directories, Git checkouts, email downloads, or other markdown locations.

`knowstr source add` should register the path in `.knowstr` metadata. It should not rewrite the file, fork it, or copy it into my editable workspace. Configured source paths should be excluded from `knowstr save`'s editable workspace scan.

UI equivalent: Shared Sources settings, “watch this folder/file”, or “add shared document source”.

### `knowstr show <address>`

Render a visible document or node read-only.

```sh
knowstr show <address>
```

Addresses can be concrete graph addresses or existing browser URLs:

```sh
knowstr show <author>:<knowstr_doc_id>
knowstr show <author_node_id>
knowstr show knowstr.com/d/<author>/<doc-id>
knowstr show knowstr.com/r/<node-id>
```

Current URL meanings are:

- `/d/<author>/<doc-id>` addresses a document container
- `/r/<node-id>` addresses a node/subtree rooted at that concrete node ID

Concrete documents should be addressable as `author:knowstr_doc_id`. A bare document ID may be accepted only when it resolves unambiguously.

For a whole document, `show` prints markdown with the source/original `knowstr_author`, `knowstr_doc_id`, optional preserved frontmatter such as `knowstr_vote_id`, and node IDs. When rendering from Nostr or another signed source, `knowstr_author` should be set from the verified signer/source identity, not blindly copied from embedded frontmatter.

For a node/subtree address such as `knowstr.com/r/<node-id>`, `show` renders the addressed node/subtree, not the containing document by default. It must still print frontmatter with `knowstr_author: <source-author>` so that the copied `id:` comments remain namespaced. For node/subtree output, `knowstr_doc_id` may be absent unless a whole document is being shown. If the containing source document has `knowstr_vote_id` and it is known, `show` should preserve it in the frontmatter.

`show` does not fork, save, import, register a source, or create editable local IDs. It is a read/render/export operation.

Example transport-independent handoff:

```sh
knowstr show knowstr.com/d/<author>/<doc-id> > /ftp/alice/holiday-destinations.md
```

A recipient who only wants to observe or derive suggestions can add the file as a source:

```sh
knowstr source add /ftp/alice/holiday-destinations.md
knowstr suggest
```

A recipient who wants to edit it creates an explicit import/fork:

```sh
knowstr import /ftp/alice/holiday-destinations.md holidays.md
```

UI equivalent: opening `knowstr.com/d/<author>/<doc-id>` or `knowstr.com/r/<node-id>` in the browser displays the document or node. Foreign content is read-only and offers source/import flows rather than direct editing.

### `knowstr import <source-file> [workspace-path]`

Create my editable fork from a foreign/source markdown file.

```sh
knowstr import <source-file> [workspace-path]
```

The source file remains foreign and read-only. `import` writes a new Bob-owned markdown file into the editable workspace. If `[workspace-path]` is omitted, Knowstr may derive a path from the source filename or document title.

It should:

- read the source markdown file
- register the source file as a read-only source if it is not already covered by an existing source directory
- create an immutable fork-time source snapshot as the importer/forker saw it
- create a new `knowstr_doc_id`
- rewrite `knowstr_author` to me
- mint new local node IDs
- copy visible content and tree structure
- convert each foreign `id:X` into `basedOn="<source-author>_X" snapshot="<fork-baseline>"`
- preserve existing source `basedOn` lineage by pointing my new node to the immediate concrete source node
- preserve `knowstr_vote_id` if it is set
- write the resulting markdown to the destination workspace path

It must never import another user’s concrete IDs as my editable IDs.

UI equivalent: Import/Fork source document into my workspace.

### Future convenience: `knowstr fork <address>`

`knowstr fork` is not required for v1. A future `fork` command may be added as a convenience wrapper around `show` plus `import`, especially for non-file graph addresses or URLs. It should not introduce different graph semantics from explicit import/forking.

### `knowstr save`

Commit/normalize the current editable markdown workspace into my authored graph.

It should:

- assign missing document IDs and node IDs
- add `knowstr_author: <me>` where needed
- generate fresh random `knowstr_doc_id` where needed
- preserve `knowstr_doc_id` on owned documents
- preserve `basedOn`
- preserve `snapshot`
- ensure every `basedOn` node has a `snapshot` pointer where possible
- preserve optional/future frontmatter such as `knowstr_vote_id`; if `knowstr_vote_id` is set, do not drop it
- reject foreign-authored files in the editable workspace with a clear instruction to use `knowstr import <file> [path]` or `knowstr source add <file-or-dir>`
- reject IDs without author namespace
- reject duplicate local concrete node IDs for the same author
- reject duplicate local concrete document identities
- reject invented/unknown local IDs where possible

Git remains responsible for filesystem history. `knowstr save` is the Knowstr-level graph/materialization commit for my editable workspace. It is not the command for ingesting other people’s markdown.

### `knowstr suggest`

Add suggestions from configured sources into my editable markdown files.

```sh
knowstr suggest [--dry-run] [--json]
```

It should:

- read all configured sources
- parse source markdown using its own `knowstr_author` namespace
- validate signed authors where the source transport supports it
- keep source documents foreign/read-only
- never rewrite, delete, clear, or move source files
- not create my editable fork of a whole source document
- compare visible source lineage variants against my local authored graph
- add new suggestions into my editable markdown as my local `(?)` suggestion nodes
- mint my local node IDs for those suggestion nodes
- write `basedOn` pointers to the immediate source suggestion nodes
- write immutable `snapshot` pointers to the source baseline
- preserve `knowstr_vote_id` if it is set
- print a CLI summary/log of what was added, skipped, or conflicted
- not write a `knowstr_log.md` file by default

If Bob has Alice’s document only as a source and no local fork, `suggest` may report that there is no local target for source-derived suggestions. Bob uses `knowstr import` if he wants to edit or receive suggestions against his own fork.

`knowstr suggest` should never insert another user’s concrete node as my editable node. It creates my own suggestion node with provenance.

UI equivalent: Add suggestions from sources / materialize source suggestions into my document as `(?)` candidates.

### Future `knowstr aggregate <vote-id>`

Future command, not v1.

Compute a voting aggregate for visible documents participating in a `knowstr_vote_id`.

The exact output format and ranking formula are intentionally open.

## UI model

The graphical model is:

```text
open visible source document/root/node -> read-only if foreign, editable if mine
source add                            -> track read-only markdown input
suggest                               -> add source suggestions as my local `(?)` nodes
import                                -> create my authored fork from a source
edit                                  -> edit my authored graph
save/publish                          -> my latest concrete document
future aggregate                       -> voting/ranking view over a knowstr_vote_id
```

The app can show collaborative state in these places:

- **Sources / Shared with me**: visible read-only documents and nodes
- **My Document**: my editable authored document
- **Suggestions**: my document plus non-destructive overlays from visible lineage variants
- **Lineage / Versions**: concrete variants, provenance, additions, removals, renames
- **Future Aggregate**: optional voting/ranking view over visible documents with the same `knowstr_vote_id`

The UI should prevent editing another user’s concrete nodes directly.

If a user wants to edit foreign content, they import/fork it into their own workspace.

## Usecase fit

### Decide about locations

This is the primary future voting aggregate usecase.

Alice, the CEO of Moving Village, shares a document of candidate locations. Shareholders fork the document, reorder candidates, mark relevance, add new candidates, and add pro/contra arguments.

For v1, the important behavior is safe forking, node lineage, suggestions, and preserved order/markers.

A future aggregate can later show:

- which locations are preferred
- which locations are on top
- which locations are marked not relevant
- which new locations were added
- which arguments matter
- which locations are controversial

This is not a forum thread. Each author keeps a living markdown document. The aggregate is a future computed voting view over those documents, grouped by `knowstr_vote_id`, not by document lineage or reused document IDs.

### The entrepreneur

Carol has a large private knowledge graph. She does not want to share the graph. Her LLM compiles concrete task/context documents for employees.

Employees can fork or edit their own authored copies. Carol’s LLM can inspect visible updates, suggestions, and diffs, then decide what to integrate back into Carol’s private graph.

The model must avoid leaking Carol’s private graph unless she explicitly publishes the relevant document or nodes.

Redacted lineage/snapshots remain an open question. For this usecase, Knowstr may need explicit export modes later:

- lineage-preserving export
- redacted lineage export
- independent export with no provenance
- private mapping known only to Carol’s local agent

### Kapitaltheorie

Students can fork shared excerpts or notes. Other students’ useful annotations appear as suggestions.

This gives Bob non-destructive input without replacing his own study graph.

A voting aggregate is optional and future-only here. Suggestions are the main collaboration feature.

### Opsec

Club members can see visible content from other members according to membership/visibility rules outside this model.

Each member can fork and arrange content for their own needs.

Suggestions can be computed over what is visible.

Token management, encrypted visibility, and cryptographic author trust are out of scope for the core graph model. The core graph model by itself is not an opsec system: lineage, snapshots, author IDs, and optional vote IDs can all leak metadata if published.

## Safety invariants

- sharing means visibility, not edit rights
- users only save/publish their own concrete nodes
- another user’s signed nodes are never overwritten
- concrete node IDs are namespaced by author
- concrete document identity is `author + knowstr_doc_id`
- `knowstr_doc_id` is a fresh random document-id part, not the full identity by itself
- raw `knowstr_doc_id` values should not be intentionally reused
- documents do not have `basedOn` lineage
- whole-document forks create a new `knowstr_doc_id`
- node/subtree forks into existing documents preserve the target document’s `knowstr_doc_id`
- optional `knowstr_vote_id` is the future voting scope
- if `knowstr_vote_id` is set, saves/imports preserve it and `suggest` reads it from sources
- same `knowstr_vote_id` across documents may define a future voting aggregate scope
- same `knowstr_doc_id` across documents must not be used as collaboration state
- node `basedOn` defines provenance and semantic lineage
- node `snapshot` defines the immutable fork-time source baseline created by the forker/importer
- `knowstr save` refuses foreign-authored files in the editable workspace; `knowstr import` creates the fork explicitly
- source files are read-only inputs and are not rewritten by `suggest`
- IDs without author namespace are invalid
- duplicate local concrete node IDs for the same author are rejected
- duplicate local concrete document identities are rejected
- suggestions are lineage-scoped overlays until `knowstr suggest` materializes them as my local `(?)` nodes

Knowstr should not reinvent Git. A lightweight pre-save/pre-fork backup may be useful later, but the first model can rely on explicit commands, clean save checks, signatures where available, and Git for filesystem history.

## Current codebase alignment and gaps

The current codebase already has many required primitives:

- `GraphNode.author`
- concrete node IDs namespaced internally by author
- `GraphNode.docId`
- `GraphNode.basedOn`
- `GraphNode.snapshotDTag`
- `Document.author`
- `Document.docId`
- document keys of `author + docId`
- Nostr replaceable document events with `d` tags
- markdown comments with `id`, `basedOn`, and `snapshot`
- deep-copy/fork behavior that mints new IDs and sets `basedOn`
- suggestions built from lineage indexes
- snapshot events for version diffing

Important gaps against this revised model:

1. **Frontmatter `knowstr_author` is not fully implemented as the markdown namespace rule.**
   Current parsing mostly uses the active profile or event pubkey as author. The revised rule is: plaintext markdown uses frontmatter `knowstr_author` as a namespace claim, while signed transports derive or validate `knowstr_author` from the signer. `knowstr show <id>` should render markdown with the verified author already set.

2. **Explicit foreign-authored markdown import is not implemented.**
   Saving Alice-authored markdown in Bob’s editable workspace should refuse with a clear import/source instruction, not claim Alice’s IDs as Bob’s. `knowstr import <source-file> [workspace-path]` should create the authored fork explicitly.

3. **Whole-document import/fork semantics need to be explicit.**
   A whole-document import should create a new `knowstr_doc_id`, mint new node IDs, write node lineage, create fork-time snapshots, and register the source as read-only input. The old idea of preserving `knowstr_doc_id` for voting should be replaced by optional future `knowstr_vote_id`.

4. **Optional `knowstr_vote_id` is not modeled.**
   This is fine for v1. The code should not need aggregate behavior now, but markdown/frontmatter normalization, saves, imports, and future fork convenience flows must preserve `knowstr_vote_id` whenever it is set.

5. **Per-node snapshot pointers are not fully represented.**
   Current code tends to treat snapshots as root/document-level. The model wants every `basedOn` node to carry its own `snapshot` pointer. Snapshot IDs should be immutable, preferably hashes of the raw source markdown seen at fork/import time or signed event IDs, and the snapshot should be created at fork/import time by the forker/importer. Local CLI/desktop storage should use `.knowstr/snapshots/`; browser/Nostr storage can use immutable Nostr snapshot events plus IndexedDB as a cache.

6. **Voting aggregate is not implemented and should remain future work.**
   Existing suggestions/version overlays are related, but voting aggregate computation should not be part of the first implementation.

7. **`knowstr_doc_id` generation should be fresh and random by default.**
   It should not be based on title or path, and normal flows should not intentionally reuse raw document IDs. The concrete document key remains `author + knowstr_doc_id`.

8. **Duplicate checks need to account for the author namespace.**
   The filesystem currently rejects duplicate `knowstr_doc_id` values globally. That is conservative for a one-author editable workspace, but once frontmatter `knowstr_author` is implemented, the real concrete document key is `author + knowstr_doc_id`. Raw `knowstr_doc_id` reuse across authors should still be treated as suspicious/import-copy state, not collaboration state. Explicit foreign imports should create new IDs rather than treating same-ID documents as shared editable documents.

9. **IDs without author and invented local IDs need stricter checks.**
   Files with node IDs but no `knowstr_author` should be refused. User-invented IDs that look local but are unknown should be rejected where possible.

10. **CLI surface is incomplete.**
    The code currently has `init`, `save`, and `apply`. The model needs explicit `show`, `source`, `import`, and `suggest` semantics. The current `apply` behavior should be replaced by `suggest`: add suggestions from sources, leave sources untouched, and print a CLI summary instead of writing `knowstr_log.md` by default. `fork` can wait as a future convenience wrapper around `show` plus `import`; future `aggregate` should wait.

## Open questions

- If Bob imports/forks the same foreign document twice, should v1 allow two local documents or detect the earlier fork and refuse?
- How should rename suggestions be displayed and accepted?
- How should private/redacted lineage work when `basedOn` or `snapshot` would leak information?
- What exact semantics make a document with `knowstr_vote_id` count as participating in a future aggregate?
- How should independent but semantically identical future voting candidates be grouped?
