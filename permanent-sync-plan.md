# Permanent Sync Plan

## Goal

Replace the current UI-driven document query model with a permanent local replica:

- bootstrap all relevant knowledge documents into IndexedDB
- keep them synced with one broad live subscription
- make the UI read from local materialized state
- remove pane/tree/footer-driven document subscriptions from normal browsing

This plan exists to address the current performance problems:

- slow first load while the tree "settles"
- slow expand/collapse in large documents
- scroll-triggered lag
- too much repeated network/query work for the same documents

## Current Problems

### 1. Query overlap

The current UI creates multiple overlapping document subscriptions:

- pane stack loading in `SplitPaneLayout.tsx`
- root semantic/referenced-by/list loading in `SplitPaneLayout.tsx`
- row/viewport-driven loading in `TreeView.tsx`

These often target the same documents, because one root document advertises many contained semantic IDs through `#n` tags.

### 2. Query churn from scrolling

`TreeViewNodeLoader` rebuilds filters from visible rows.

That means:

- scrolling changes filters
- changing filters resubscribes
- the same events can be delivered repeatedly through overlapping subscriptions

### 3. Expensive footer coupling

Suggestions, occurrences, incoming refs, and alternative lists are currently tied too closely to normal tree traversal and loading.

Large expanded documents therefore cause:

- lots of semantic projection work
- lots of query identifier expansion
- too much work for rows outside the current viewport

### 4. Permanent sync is a better fit for the data model

The app is document-based now:

- one replaceable document per standalone root
- broad document tags (`#d`, `#r`, `#n`, `#s`)

That makes a local replica architecture more appropriate than repeated narrow UI queries.

## Target Architecture

### Core idea

The sync engine owns the network.

The UI reads local materialized state.

Normal browsing should not open Nostr subscriptions based on:

- current viewport
- expanded rows
- footer visibility
- per-pane tree shape

### Permanent local replica

IndexedDB should contain the current live document corpus for the user's read scope.

The canonical stored unit is the latest winning document per replaceable key, not an ever-growing event log used as runtime truth.

Recommended stored shape:

```ts
type StoredDocumentRecord = {
  replaceableKey: string;
  author: PublicKey;
  eventId: string;
  dTag: string;
  createdAt: number;
  updatedMs: number;
  content: string;
  tags: string[][];
  deletedAt?: number;

  // derived projection
  parsedRelations: Array<SerializedRelation>;
};
```

Important rule:

- `content` and event metadata are canonical
- `parsedRelations` is derived from that canonical event
- `parsedRelations` is never edited independently

Optional secondary tables:

- sync checkpoints per author
- author/read-scope metadata
- event IDs seen recently for duplicate suppression

## Query Model

### Live sync

Use one broad live subscription for all relevant authors.

Documents:

```ts
{
  authors,
  kinds: [KIND_KNOWLEDGE_DOCUMENT]
}
```

Deletes:

```ts
{
  authors,
  kinds: [KIND_DELETE],
  "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`]
}
```

Notes:

- this is intentionally broad
- live freshness matters more than historical completeness
- one broad live query is preferable to many overlapping UI subscriptions

### Historical backfill

Historical backfill should be paged per author, or in small author batches.

Documents:

```ts
{
  authors: [author],
  kinds: [KIND_KNOWLEDGE_DOCUMENT],
  limit: 200,
  until?: cursor
}
```

Deletes:

```ts
{
  authors: [author],
  kinds: [KIND_DELETE],
  "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
  limit: 200,
  until?: cursor
}
```

Paging strategy:

- fetch newest page first
- record the oldest `created_at` returned
- next page uses `until = oldestCreatedAt - 1`
- continue until the page is empty or smaller than `limit`

Why historical paging should not be one giant broad query:

- active authors can dominate results
- broad relay limits can starve quieter authors
- correctness is easier to reason about per author

### Meta queries

Keep these separate from document sync:

- settings
- contacts
- views
- relay metadata

## UI Query Model After Migration

### Remove from normal browsing

These should stop driving network subscriptions for ordinary browsing:

- `LoadData itemIDs={pane.stack}`
- `LoadData itemIDs={[rootSemanticID]} referencedBy lists`
- `TreeViewNodeLoader`
- `LoadRelationData` for ordinary pane rendering

### Keep only for exceptions

Some network queries may still exist for:

- search
- unsynced authors outside the current read scope
- explicit tools/debug screens

Even there, prefer querying the permanent local replica first.

## Footer Strategy

The permanent sync plan does not mean "query footer data for every row".

Instead:

- sync the full document corpus broadly
- compute footer projections locally
- only compute them for rows that actually need them

Footer work should be constrained by viewport/focus/filters, not by the full expanded tree.

Recommended grouping:

- semantic footer family: suggestions, occurrences, alternatives
- concrete relation family: incoming refs

But under permanent sync, these should become local computations first, not live Nostr subscriptions.

## Sync State

Recommended checkpoint fields per author:

```ts
type AuthorSyncCheckpoint = {
  author: PublicKey;
  docsBackfillComplete: boolean;
  deletesBackfillComplete: boolean;
  oldestFetchedDocCreatedAt?: number;
  oldestFetchedDeleteCreatedAt?: number;
  latestSeenLiveCreatedAt?: number;
};
```

Use these for:

- startup resume
- background backfill continuation
- reconnect catch-up queries

## Duplicate Event Handling

The current app likely pays significant cost from duplicate deliveries:

- multiple relays deliver the same event
- overlapping subscriptions deliver the same event again
- the pool verifies events before local dedupe

Permanent sync helps because it removes most overlapping app-level subscriptions.

Additional duplicate defenses:

- keep a recent seen-event-ID set in memory during live sync
- avoid reprocessing identical winning document events
- store the latest winning event per replaceable key directly

## Migration Phases

### Phase 1: Introduce sync engine

- add broad live document/delete sync
- add paged historical backfill per author
- persist latest document records in IndexedDB
- keep existing UI queries for now

Success criteria:

- the local replica fills correctly
- reload can restore documents from IndexedDB before relay roundtrips finish

### Phase 2: Read UI from local replica

- feed `knowledgeDBs` from the synced local replica
- stop relying on `LoadData` / `TreeViewNodeLoader` for ordinary tree browsing
- keep only meta/search exceptions

Success criteria:

- pane browsing works offline against cached data
- scrolling and expand/collapse no longer resubscribe to relays

### Phase 3: Shrink query surface

- remove pane/tree document queries
- remove footer-related live document queries from normal browsing
- keep one live document sync and background backfill

Success criteria:

- no viewport-driven document query churn
- no per-row document subscriptions

### Phase 4: Local-first footer computation

- compute footer projections from the local synced corpus
- only compute for rows that are visible/relevant
- cache per-row/per-relation semantic projection results where useful

Success criteria:

- large expanded trees remain responsive
- footer work scales with active rows, not total tree size

## Immediate Follow-Up Work

After this document is accepted, the next concrete implementation tasks should be:

1. Define IndexedDB schema for latest live documents and checkpoints
2. Build broad live sync for documents + deletes
3. Build paged per-author historical backfill
4. Feed the app from the local synced document store
5. Delete `TreeViewNodeLoader`-driven document subscriptions

