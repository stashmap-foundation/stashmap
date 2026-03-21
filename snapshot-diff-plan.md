# Snapshot Diff Plan

## Goal

Keep version discovery on `basedOn`, but make diffs and suggestions come from each version's own immutable snapshot baseline.

This plan is about:

- fixing version drift
- making suggestions belong to a specific version
- loading snapshots lazily
- never querying immutable snapshots again once they are cached locally

## Core Rules

1. Versions come from `basedOn` lineage, not semantic matching.
2. A diff is always:
   - `version head` vs `that version's snapshot baseline`
3. Suggestions are derived from that diff and belong to that specific version.
4. We do not query snapshots by `basedOn`.
5. We do not index every node id into relay-queryable tags.
6. Snapshots are immutable, so once a snapshot is stored in IndexedDB, it must never be queried again.

## Query Model

### What we query by

Snapshots should be queried by:

- `kind = KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT`
- `author`
- `#d = snapshotDTag`

This is already the right shape because the forked document root stores `snapshot="..."`, and the snapshot event has its own `d` tag.

### What we do not query by

We should not:

- query snapshots by `basedOn`
- query snapshots by every node id inside the document
- add relay tags for every node just to make moved-node lookup possible

That would explode query complexity and payload design for the wrong reason.

## Loading Strategy

### Initial render

When opening a document:

1. Build the version list from current document heads via `basedOn`.
2. Render those version rows immediately.
3. Do not block version list rendering on snapshot availability.

Version rows can render immediately with:

- author
- updated timestamp
- `(newer)` marker
- temporary diff state like `loading...`

### Lazy snapshot loading

After the version list is known:

1. Collect the `snapshotDTag` values from the visible version roots.
2. Look them up in IndexedDB first.
3. Only query relays for the missing snapshots.
4. Batch those missing `d` tags into one query when possible.

This means:

- one lazy batch per document view
- not one query per node row
- not one query per diff operation

## IndexedDB Cache

This is mandatory.

Because snapshots are immutable:

- once a snapshot is in IndexedDB, we already have the final content
- we never need to re-query it from relays
- the local cache is the source of truth for already-seen snapshots

### Required behavior

1. Snapshot query path must check IndexedDB first.
2. Missing snapshots only are queried from relays.
3. Fetched snapshots are written into IndexedDB immediately.
4. Subsequent loads must reuse the IndexedDB copy without network access.

### Why this matters

Without this rule:

- opening a document with many versions would repeatedly hit relays
- immutable data would still be treated like mutable data
- the app would pay unnecessary network cost forever

With this rule:

- snapshot loading becomes cheap after first use
- version diffing remains lazy but stable
- immutable data behaves like immutable data

## Materialization Model

Snapshots should be stored separately from live documents.

We should:

- fetch snapshot events separately
- materialize them with the existing markdown parser
- store them in a separate snapshot store keyed by `(author, snapshotDTag)`

We should not:

- mix snapshots into the live current-document store
- let snapshots affect normal current document materialization

## Diff Model

### Current problem

Right now the broken behavior is effectively:

- current node vs other version's current node

That causes drift.

Example:

- Alice forks Bob
- Bob keeps editing
- Alice's visible diff keeps growing even if Alice changed nothing

### New diff model

For a version row, compute:

- `candidateVersionNode`
- `candidateSnapshotNode`
- diff = `candidateVersionNode` vs `candidateSnapshotNode`

That gives:

- what this version changed since fork
- not what this version differs from the current document head by

## Suggestion Model

Suggestions should no longer be global pooled results.

Instead:

1. Each version computes its own diff.
2. Suggestions are derived from that version's diff.
3. Suggestions are shown under that version row.

This gives:

- small additive diffs -> inline suggestions
- broader/structural diffs -> version summary row

## Matching Strategy

When finding the corresponding node across:

- current version head
- candidate version head
- candidate snapshot

matching must be lineage-first:

1. exact id
2. direct `basedOn`
3. `basedOn` ancestry walk

Semantic matching should not be the default fallback anymore.

This is necessary to avoid rename drift where a renamed node looks like a brand new suggestion.

## Root vs Non-Root Behavior

### Root node

Show:

- full version history from `basedOn`
- immediately from current heads
- then enrich rows with snapshot-based diffs once available

### Non-root node

Do not query anything separately per node.

Instead:

1. reuse the already-known document versions
2. reuse the already-loaded snapshots for those versions
3. compute the current node's per-version diff from those loaded baselines

## Edge Cases

### Versions without snapshot pointers

If a version has no `snapshotDTag`:

- still show the version row
- but do not pretend we have a stable fork diff

### Missing or deleted snapshot

If the snapshot event cannot be found:

- keep the version row
- show snapshot unavailable / diff unavailable state

### Original non-fork documents

If a version is just an original document head and not a fork:

- no snapshot is expected
- no fork-based diff is available

### Node moved into another document

This is the hard case.

For the first implementation:

- do not solve it by indexing every node id for relay queries

If we need to support this case later, the better solution is:

- optional node-level snapshot pointer for that moved/copied node

That is a targeted solution, not a global indexing explosion.

### Non-root node with cross-document `basedOn`

Example:

- `Holiday Destinations -> Spain -> Barcelona`
- basedOn `Cities in Catalunya -> Barcelona`

In this case, the node's lineage leaves the current document version set.

For V1:

- do not issue extra per-node queries
- do not try semantic matching across arbitrary documents
- do not query snapshots by node id or `basedOn`
- reuse only the already-loaded snapshots for the current document's visible versions
- if the node cannot be resolved inside those version heads/snapshots, show diff unavailable

This keeps the non-root query model bounded to one document view and preserves the rule that snapshot loading is batched and lazy.

If we want to support this later, the right approach is explicit node-level provenance, for example:

- source author
- source root id
- source node id
- source snapshot d tag

Then a future implementation could query that exact snapshot baseline directly without falling back to global semantic search or node-id indexing.

## Implementation Order

1. Add snapshot query path by `author + snapshotDTag`.
2. Add snapshot storage in IndexedDB.
3. Add snapshot materialization into a separate snapshot store.
4. Build version list from current heads only.
5. Add lazy snapshot loading for visible versions.
6. Add helpers to resolve the corresponding node in:
   - version head
   - version snapshot
7. Rewrite version diff computation to use snapshot baseline.
8. Rewrite suggestions to be derived from each version diff.
9. Handle edge cases and loading states.

## Tests

We should add tests for:

1. snapshot query by `author + dTag`
2. IndexedDB cache hit skips relay query
3. version list renders before snapshots arrive
4. snapshot fetch is batched for visible versions
5. diff stays stable when source branch keeps editing after a fork
6. renamed node is matched by lineage rather than treated as a new suggestion
7. suggestions belong to one version row only

## Final Principle

The important split is:

- `basedOn` gives us version lineage
- `snapshotDTag` gives us stable fork baselines
- IndexedDB gives us persistent immutable caching

That combination fixes drift without turning snapshot lookup into a network-heavy or semantics-heavy system.
