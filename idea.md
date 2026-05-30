# Knowstr collaboration idea

Knowstr is a markdown-first graph editor. Users think in small text blocks, arrange them into documents, link them into a graph, and keep the underlying files readable and editable as normal markdown.

The collaboration problem is not shared mutable editing. In an agent-centric world, every person has their own second brain, with their own graph, structure, priorities, and agents. Collaboration should let people work on the same question, document, or subtree without giving anyone the ability to overwrite someone else’s concrete graph entities.

The revised core idea is:

> Collaboration uses a shared, globally unique document envelope plus node lineage. A user forks an existing document, root, node, or subtree into their own authored document or graph location. Their nodes get new local IDs, `basedOn` pointers back to the source nodes, and `snapshot` pointers to the fork-time baseline. Results aggregate all visible authored documents with the same `knowstr_doc_id`, one document per author.

This is not Google Docs. It is not shared mutable node IDs. It is also not a one-time form submission. It is a set of living authored documents that can be compared, overlaid as suggestions, and aggregated into results.

## Core model

Any document, document root, node, or subtree can become collaborative.

For a whole-document collaboration, the document has a shared envelope ID. `knowstr_doc_id` is a globally unique random ID, not a human-readable slug. Human-readable names belong in normal metadata such as `title` or `slug`.

```md
---
author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
title: Holiday Destinations
---
```

The concrete document identity is namespaced by author:

```text
alice:kdoc_8f6b1c4d2e9a
bob:kdoc_8f6b1c4d2e9a
carol:kdoc_8f6b1c4d2e9a
```

The aggregate/collaboration set is all visible documents with the same `knowstr_doc_id`:

```text
*:kdoc_8f6b1c4d2e9a
```

For results, Knowstr counts at most one document per author for a given `knowstr_doc_id`. In Nostr terms this naturally means the latest replaceable document event from each author for that `d` tag. In filesystem terms `knowstr save` must reject duplicate local documents with the same `author + knowstr_doc_id`.

Inside those documents, nodes are concrete authored graph entities. A user can only save or publish their own concrete nodes. They can never mutate Alice’s signed nodes, even if their nodes are based on Alice’s work.

Computed projections over the visible documents and node lineage include:

- suggestions overlay
- results aggregate

These are not one-time submissions. They are living graph entities. For example, an investment company may have a collaborative question called “Where should we invest next?” Each author can keep updating their own document in that shared envelope over time by adding ideas, reordering them, marking them relevant or not relevant, and adding reasoning.

## Document IDs, authored documents, and aggregates

`knowstr_doc_id` is not a `basedOn` lineage pointer. There is no document-level `basedOn` chain.

Instead:

- `author + knowstr_doc_id` is the concrete authored document identity
- the same `knowstr_doc_id` across authors defines the collaboration/aggregate envelope
- node `basedOn` pointers define semantic lineage inside and across those documents
- node `snapshot` pointers define the fork-time baseline for those lineage pointers

A whole-document fork preserves the `knowstr_doc_id`.

Alice publishes:

```md
---
author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

Bob forks it:

```md
---
author: bob
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

Both documents are part of the same aggregate because they have the same `knowstr_doc_id`. They do not conflict because their concrete identities are different:

```text
alice:kdoc_8f6b1c4d2e9a != bob:kdoc_8f6b1c4d2e9a
```

This replaces the need for per-node active-head pointers. Bob’s counted contribution is simply Bob’s latest visible `kdoc_8f6b1c4d2e9a` document. Everything materialized in that document counts according to the results rules.

If Bob creates another document with a different `knowstr_doc_id` that contains nodes based on Alice’s nodes, it can still participate in suggestions and lineage comparison, but it is not Bob’s counted document in the `kdoc_8f6b1c4d2e9a` aggregate.

Important invariant:

- same `knowstr_doc_id` = same collaboration/aggregate envelope
- same `author + knowstr_doc_id` = same concrete authored document
- one concrete authored document per author per `knowstr_doc_id`
- node `basedOn` = semantic lineage/provenance, not document identity
- node `snapshot` = where to look up the fork-time baseline for that `basedOn` node

## Concrete node IDs vs lineage

Concrete node IDs are local editable ownership IDs. They should not be preserved across users.

Alice may have:

```text
alice_A1 = Holiday Destinations
alice_A2 = Spain
alice_A3 = Barcelona
```

Bob’s editable fork should not reuse Alice’s concrete node IDs. It should be:

```text
bob_B1 basedOn alice_A1 = Holiday Destinations
bob_B2 basedOn alice_A2 = Spain
bob_B3 basedOn alice_A3 = Barcelona
```

Carol can have another fork:

```text
carol_C1 basedOn alice_A1 = Holiday Destinations
carol_C2 basedOn alice_A2 = Spain
carol_C3 basedOn alice_A3 = Barcelona
```

So concrete identity differs:

```text
alice_A1 != bob_B1 != carol_C1
```

But lineage connects them:

```text
origin(alice_A1) = alice_A1
origin(bob_B1)   = alice_A1
origin(carol_C1) = alice_A1
```

This lets Alice’s, Bob’s, and Carol’s concrete forks coexist in the same graph without duplicate node ID conflicts.

Important invariant:

- concrete node IDs are editable ownership IDs
- `basedOn` / lineage is the cross-user semantic relationship
- `snapshot` points to the fork-time baseline used for precise diffs
- suggestions, variant comparisons, and results are computed from lineage, snapshots, and document envelopes

This replaces the older idea that shared node UUIDs should be preserved across users.

## Baseline snapshots

`basedOn` tells Knowstr which concrete source node a forked node came from. `snapshot` tells Knowstr where to look up the fork-time version of that source node.

For the first implementation, snapshots can be whole-source-document snapshots. That is simple and robust: when Bob forks Alice’s document, Knowstr stores Alice’s whole document as Bob saw it at fork time, and every Bob node that has `basedOn="alice_..."` points to that same snapshot.

Example:

```md
# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
  - Barcelona <!-- id:B3 basedOn="alice_A3" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

The `snapshot` pointer should be written on every node that has `basedOn`, not only on the fork root. This denormalization is intentional. If a child is later moved, copied, or separated from its parent, it still knows how to interpret its own `basedOn` pointer.

Rule:

```text
basedOn=<source-node-id> + snapshot=<baseline containing that source-node-id>
```

A more byte-efficient future implementation may snapshot only the forked subtree and its descendants. The semantics stay the same: the snapshot must contain every source node referenced by a `basedOn` pointer that names it.

If a snapshot is missing, the graph is still safe: ownership, lineage, and aggregate results still work. What degrades is precise version diffing. The UI/CLI should fall back conservatively rather than inventing additions/deletions.

## Forking is author-agnostic

The beautiful part of the model is that `fork` does not mean “copy from another user”. It means:

> Create a new concrete authored graph entity based on an existing concrete graph entity.

The source can be Alice’s node, Bob’s node, or my own node. The same semantics apply:

- new concrete node IDs
- `basedOn` points to the source nodes
- `snapshot` points to the fork-time baseline
- the fork can then diverge freely

This makes self-forks and contextual forks first-class.

Example: I read an economics article, then drag/fork it under “Real estate in Barcelona”. I may delete paragraphs that are irrelevant in that context and rename others. The fork remains linked to the original article through `basedOn`, and precise version comparison remains possible through `snapshot`.

The source author does not define the operation. The operation semantics do:

1. **Move**
   - same concrete node IDs
   - no new `basedOn`
   - no new `snapshot`

2. **Reference**
   - link to an existing node/document
   - no copied content
   - no new `snapshot`

3. **Fork**
   - new concrete node IDs
   - `basedOn` on copied nodes
   - `snapshot` on copied nodes
   - source can be another user or myself

4. **Duplicate as independent**
   - new concrete node IDs
   - no `basedOn`
   - no `snapshot`
   - useful when I explicitly want an unrelated copy

A whole-document collaboration fork is just one important case of this general fork operation. A contextual DnD copy can also be a fork when I want provenance and version comparison.

Display principle for contextual forks:

- upstream/source additions can appear as normal suggestions
- upstream/source deletions should stay summarized in version rows, e.g. `+5 -3`, not as scary inline deleted nodes
- things I removed from my contextual fork are treated as intentional omissions, not as errors

## Documents are envelopes and materializations

Documents are important because markdown files are the editing interface. For whole-document collaboration, the document ID is also the aggregate envelope. But documents are still not shared mutable documents.

A document is an authored materialized container for graph nodes. The file path can change without changing the collaboration, as long as the `knowstr_doc_id` stays the same.

Example: Alice shares:

```md
---
author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
  - Barcelona <!-- id:A3 -->
```

Bob forks it and may store it in any file path he wants:

```md
---
author: bob
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
  - Barcelona <!-- id:B3 basedOn="alice_A3" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

Bob’s file name can be `locations.md`, `alice-question.md`, or anything else. The aggregate follows `knowstr_doc_id`, not the file path.

If Bob copies the collaborative root into another unrelated document:

```md
---
author: bob
knowstr_doc_id: kdoc_32ad0c9f71b4
---

# Trips with my wife <!-- id:T1 -->

- Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
  - Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

then the copied nodes still have lineage to Alice’s nodes, so suggestions and provenance can work. But this document is not Bob’s counted document in the `kdoc_8f6b1c4d2e9a` aggregate, because its `knowstr_doc_id` is different.

Therefore:

- files are editing/materialization surfaces
- `knowstr_doc_id` is the document/collaboration envelope
- nodes are authored graph objects inside the envelope
- collaboration results follow `knowstr_doc_id`
- semantic comparison follows node lineage
- file paths do not define collaboration identity

There should not be a special visible `collaborations/` folder. Every normal document can be an authored document in a collaboration envelope, a draft, a private note, or an unrelated materialization depending on its frontmatter and node lineage.

## Markdown author namespace rule

Markdown must be safe to send over Slack, email, Git, or copy/paste.

To make this work, `id:` comments require an author namespace in frontmatter.

A file with node IDs must have frontmatter like:

```md
---
author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
```

The effective concrete node IDs are:

```text
alice_A1
alice_A2
```

The effective concrete document identity is:

```text
alice:kdoc_8f6b1c4d2e9a
```

If Bob saves a whole foreign-authored file whose frontmatter author is Alice, Knowstr must not treat Alice’s IDs as Bob’s IDs. It should fork the document:

```md
---
author: bob
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

Rules:

1. **No author, no IDs**: valid draft. `knowstr save` adds `author: <me>`, a `knowstr_doc_id`, and local node IDs.
2. **author == me**: owned editable file. `knowstr save` updates my graph.
3. **author != me**: foreign/import file. `knowstr save` auto-forks it: it preserves the `knowstr_doc_id` for whole-document forks, creates a source-document snapshot, converts foreign `id:` values into `basedOn`/`snapshot` pointers, mints my IDs, and rewrites author to me.
4. **IDs but no author**: invalid. `knowstr save` must refuse.
5. **Duplicate local `author + knowstr_doc_id`**: invalid. `knowstr save` must refuse or require an explicit merge/replace flow.
6. **Duplicate local concrete node IDs**: invalid. `knowstr save` must refuse.

Frontmatter `author` is a namespace, not cryptographic proof. If markdown came through an unsigned channel, the user trusts that channel. Signed transports can verify authorship separately.

This rule keeps plain markdown transport possible while avoiding dangerous duplicate IDs.

## Foreign-authored documents auto-fork

If a whole markdown document with `author: alice` is added to Bob’s workspace, Bob should be able to run `knowstr save` safely. Knowstr should not import Alice’s concrete IDs as Bob’s IDs. It should create Bob’s own authored fork of that document.

Input:

```md
---
author: alice
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:A1 -->
- Spain <!-- id:A2 -->
  - Barcelona <!-- id:A3 -->
```

After Bob runs `knowstr save`:

```md
---
author: bob
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
  - Barcelona <!-- id:B3 basedOn="alice_A3" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
```

The import/fork operation applies to every node in the document:

- the `knowstr_doc_id` is preserved
- each foreign `id:X` becomes `basedOn="alice_X" snapshot="<fork-baseline>"`
- each node receives a fresh Bob-owned `id:Y`
- the tree structure is preserved
- the visible markdown remains editable as Bob’s graph
- Bob’s document joins the same aggregate because it has the same `knowstr_doc_id`

If the foreign nodes already have their own `basedOn` values, Bob’s new nodes should still point to the immediate concrete source he imported, e.g. `basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a"`. The full lineage can then be followed through Alice’s node if it is available.

If Bob already has a local document with the same `author + knowstr_doc_id`, Knowstr must not silently create a second counted document for Bob. It should either:

- open/update/merge into Bob’s existing authored document through an explicit flow, or
- refuse with a clear error and ask Bob to merge manually.

The first simple implementation can refuse.

## Fork, show, save, pull

The graphical model is:

```text
open a source document/root      -> readonly if foreign, editable if mine
click fork                       -> my authored fork / deep copy with new node IDs, basedOn, and snapshot
edit                             -> my authored graph
save/publish                     -> my latest authored document for that knowstr_doc_id
```

The CLI should mirror this. `checkout` should not be the core primitive.

### `knowstr show <doc-id|node-id>`

Render a shared document or node read-only.

For a whole document, this prints markdown with an `author:` namespace and `knowstr_doc_id`. If the user saves that foreign-authored markdown, Knowstr safely forks it by preserving the `knowstr_doc_id`, creating a source-document snapshot, minting local node IDs, and converting source IDs to `basedOn`/`snapshot`.

### `knowstr fork <doc-id|node-id>`

Create my editable fork of an existing document/root/subtree. The source may be another user’s graph or my own graph.

For a whole-document fork, the fork:

- preserves `knowstr_doc_id`
- mints new local node IDs
- preserves content and structure
- creates a fork-time snapshot of the source document
- writes `basedOn` and `snapshot` pointers to the source nodes
- saves as me
- becomes my authored document for that aggregate

For a node/subtree fork into an existing local document, the target document keeps its own `knowstr_doc_id`. The copied nodes still get `basedOn` and `snapshot` pointers, but the target document does not automatically become part of the source document’s aggregate. This applies equally to forks from my own graph and forks from other users’ graphs.

### `knowstr save`

Commit/normalize the current markdown workspace into my authored graph.

It should:

- assign missing document IDs and node IDs
- add `author: <me>` where needed
- preserve `knowstr_doc_id` on owned documents
- preserve `knowstr_doc_id` when auto-forking whole foreign documents
- preserve `basedOn`
- preserve `snapshot`
- ensure every `basedOn` node has a `snapshot` pointer where possible
- convert foreign-authored markdown into my fork
- reject IDs without author namespace
- reject duplicate local concrete node IDs
- reject duplicate local `author + knowstr_doc_id` values
- reject invented/unknown local IDs where possible

Git remains responsible for filesystem history. `knowstr save` is the Knowstr-level graph/materialization commit.

### `knowstr pull` / `knowstr apply`

Materialize suggestions from other visible lineage variants into my markdown files.

The UI can compute suggestions in memory. CLI and agents often need materialized markdown. Pull/apply should write incoming suggestions as my local `(?)` nodes with new local IDs, `basedOn` pointers to the source suggestion, and `snapshot` pointers to the fork-time baseline.

Example:

```md
---
author: bob
knowstr_doc_id: kdoc_8f6b1c4d2e9a
---

# Holiday Destinations <!-- id:B1 basedOn="alice_A1" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- Spain <!-- id:B2 basedOn="alice_A2" snapshot="snap-alice-kdoc_8f6b1c4d2e9a" -->
- (?) Portugal <!-- id:B9 basedOn="carol_C7" snapshot="snap-carol-kdoc_8f6b1c4d2e9a" -->
```

Pull/apply should never insert Carol’s concrete node as my editable node. It should create my maybe-relevant copy based on Carol’s node.

Important consequence:

- overlay suggestions do not count in results
- materialized nodes inside my authored document do count as my current stance

## No active heads; one authored document per author per envelope

Knowstr does not need per-node active-head pointers.

Old idea:

```text
activeFork[bob, alice_A1] = bob_B1
```

New rule:

```text
Bob's active contribution for kdoc_8f6b1c4d2e9a = latest visible bob:kdoc_8f6b1c4d2e9a document
```

For each `knowstr_doc_id`, every author can have one concrete authored document:

```text
alice:kdoc_8f6b1c4d2e9a
bob:kdoc_8f6b1c4d2e9a
carol:kdoc_8f6b1c4d2e9a
```

Results aggregate these documents. This prevents Bob from double-counting because Bob cannot have two local authored documents with the same `author + knowstr_doc_id`, and on Nostr the latest replaceable event for Bob’s `d` tag wins.

A user may still create drafts or variants by using a different `knowstr_doc_id`:

```text
bob:kdoc_5d2a91e4c0bf  # draft/variant titled "Holiday Destinations draft"
bob:kdoc_32ad0c9f71b4  # private travel notes
```

Those documents can contain nodes based on Alice’s nodes. They can appear in suggestions if visible. They do not count in the `kdoc_8f6b1c4d2e9a` results aggregate.

Default behavior:

- whole-document fork preserves `knowstr_doc_id` and becomes my authored document for that envelope
- second local document with the same `author + knowstr_doc_id` is refused by `knowstr save`
- variants/drafts use different globally unique random document IDs
- publishing updates my contribution by replacing my previous document event for that `knowstr_doc_id`

## Suggestions vs results

Aggregate has two meanings and they must remain separate.

### Suggestions overlay

Suggestions are a working overlay on my current fork/local entity.

For suggestions, Knowstr can inspect all visible lineage variants, including drafts and documents with different `knowstr_doc_id` values, as long as their nodes are connected through `basedOn` lineage.

If Bob has two visible variants:

```text
bob:kdoc_8f6b1c4d2e9a adds Portugal
bob:kdoc_5d2a91e4c0bf adds Greece
```

Alice may see both as suggestions:

```md
# Holiday Destinations
- Spain
- (?) Portugal
- (?) Greece
```

Suggestions should be deduplicated where possible, but provenance should be retained.

### Results aggregate

Results are the group output for one document envelope:

- which items were added by participants
- how participants ranked them
- how many marked them relevant, maybe relevant, or not relevant
- which items are controversial
- which items have consensus

For results, Knowstr counts:

```text
all visible documents with the same knowstr_doc_id
at most one latest document per author
```

So:

```text
suggestions = all visible lineage candidates
results     = one authored document per author per knowstr_doc_id
```

This prevents Bob from counting twice if he has multiple drafts or variants.

Within one authored document, results should count each candidate lineage at most once. If a document contains conflicting duplicate entries for the same candidate lineage, the first implementation should reject or flag the document instead of guessing.

## Safety

Important invariants:

- users only save/publish their own concrete nodes
- another participant’s signed nodes are never overwritten
- concrete node IDs are namespaced by author
- concrete document identity is `author + knowstr_doc_id`
- same `knowstr_doc_id` across authors defines the aggregate envelope
- IDs without author namespace are invalid
- saving foreign-authored markdown creates a fork, not an overwrite
- whole-document forks preserve `knowstr_doc_id`
- whole-document forks create a source-document snapshot
- every node with `basedOn` should also have `snapshot`
- node/subtree forks into unrelated documents preserve `basedOn`/`snapshot`, not `knowstr_doc_id`
- duplicate local concrete node IDs are rejected
- duplicate local `author + knowstr_doc_id` values are rejected
- results count one latest authored document per author per `knowstr_doc_id`

Knowstr should not reinvent Git. A lightweight pre-save/pre-fork backup may be useful later, but the first model can rely on explicit commands, clean save checks, signatures where available, and Git for filesystem history.

## UI model

The app can show collaborative state in two places:

- **Shared with me**: visible documents, nodes, and collaboration envelopes
- **Inside a document/node**: lineage browser, suggestions, and results

Inside a collaborative document/root, the user can switch between:

- **My Document**: my editable authored document with this `knowstr_doc_id`
- **Lineage Browser**: concrete node variants and provenance across visible authors; foreign concrete nodes are read-only
- **Suggestions**: my document plus incoming proposed additions/changes from visible lineage variants
- **Results**: aggregate/poll-style output across visible authored documents with the same `knowstr_doc_id`

The UI can prevent editing another user’s concrete nodes directly. If a user wants to edit, they fork.

## Product principle

Knowstr collaboration should feel like this:

> Here is a document, node, subtree, or collaboration envelope. Everyone can maintain their own living authored document or fork. We can compare variants, see suggestions, compute group results, and each person decides what becomes their own graph.

Not Google Docs. Not one shared mutable document. Not one-time form submission.

A living graph collaboration model for markdown.

## Open questions

- What exact frontmatter fields should be used for author namespace, document ID, and import metadata?
- What exact globally unique random format should `knowstr_doc_id` use (UUIDv4, ULID, Nostr-address-like random string, etc.)?
- How strict should `knowstr save` be about unknown local IDs?
- When Bob imports a foreign document for an envelope where he already has his own authored document, should the first implementation refuse, replace, or offer a merge flow?
- How should results weighting work for relevance and ordering?
- How should duplicate candidate lineages inside one authored document be handled?
- Should other authors’ documents in the same envelope be visible by default, visible only after joining, or hidden behind aggregate results?
- How should private/redacted lineage work for cases where `basedOn` or `snapshot` would leak information?
- Should `apply` be renamed to `pull`, or should both exist with slightly different meanings?
