# Architectural Analysis: Relations as the Primary Tree Structure

## Your Three Observations — Validated

### a) Content-addressed node IDs are suboptimal

**Confirmed.** `hashText(text).slice(0,32)` means same text = same ID globally. This causes:

1. **Collision workarounds** — `resolveCollisions()` + `findUniqueText()` create "Apple (1)" variants just to have unique hashes in the same relation (markdownDocument.tsx:611-619)
2. **NodeIndex tracking** — ViewPath needs `NodeIndex` to track "which occurrence of this hash in this relation" (ViewContext.tsx:763-774)
3. **Rename breaks identity** — changing text changes the hash, so the "same item" becomes a "different node"
4. **Forced sharing** — two users independently writing "Apple" get the same node whether they want it or not

### b) "Always show current document" instead of re-deciding

**Confirmed.** The current tree walk (`treeTraversal.ts:83-92`) calls `getRelationsForContext()` which does:

```
authorDB.relations.filter(r =>
  r.head === nodeHash && contextsMatch(r.context, context)
).sortByDate().first()
```

This is a **query** — given a node hash + context path + author, find the best matching relation. It was necessary in the old event-per-relation model because relations arrived independently and you had to reconstruct the tree.

With markdown documents, the tree is **already encoded in the document**. Each item's UUID directly identifies the child relation. Re-deriving the tree from (hash, context, author) is unnecessary work that introduces ambiguity.

The inline version-switching UI is gone — other versions are just links to other documents. So: show the current document's tree, period.

### c) Relations should reference parent relations, not parent nodes

**Confirmed with nuance.** Currently:
- `Relations.head: ID` — points to a **node** (content hash)
- `Relations.context: Context` — path of **ancestor node hashes**
- `RelationItem.nodeID: LongID | ID` — children are **node hashes**

To find the child relation for an item, you must query: `(author, item.nodeID, parentContext + parentHead)`. This is the expensive, ambiguous lookup.

If items referenced child relations directly (`item.relationID: LongID`), the tree walk becomes a simple ID lookup. No query, no ambiguity.

---

## The Unified Insight

All three observations converge on one idea: **the tree should be a tree of Relations (UUID-based), not a tree of Nodes (hash-based).**

### Current tree walk
```
Relation(head=hash, context=[...])
  → items: [{nodeID: childHash}, ...]
    → query: getRelationsForContext(author, childHash, newContext)
      → Relation(head=childHash, context=[..., hash])
        → repeat
```

### Proposed tree walk
```
Relation(id=UUID, text="Root")
  → items: [{relationID: childUUID}, ...]
    → lookup: relations.get(childUUID)
      → Relation(id=childUUID, text="Child")
        → repeat
```

This eliminates:
- `getRelationsForContext()` / `getNewestRelationFromAuthor()` — no more query by (hash, context)
- `resolveCollisions()` / `findUniqueText()` — no more "Apple (1)" variants
- `NodeIndex` — no more occurrence tracking within a relation
- Ambiguity about "which relation" — UUID is a direct pointer
- Note: `context` stays on Relations — needed as cross-author coordinate for suggestions/versions

---

## What Changes

### Relations absorb node text

```typescript
// BEFORE
type Relations = {
  id: LongID;          // author_UUID
  head: ID;            // hash of text (content-addressed)
  items: List<RelationItem>;
  context: Context;    // ancestor hashes
  root: ID;            // document root UUID
  ...
};

type RelationItem = {
  nodeID: LongID | ID; // child node hash
  relevance; argument; virtualType;
};

// AFTER
type Relations = {
  id: LongID;          // author_UUID (unchanged)
  text: string;        // the actual text (was on Node)
  textHash: ID;        // hashText(text) — for occurrence lookup, Nostr #n tags
  items: List<RelationItem>;
  parent: LongID | undefined; // parent relation (replaces context)
  root: ID;            // document root UUID (unchanged)
  ...
};

type RelationItem = {
  id: LongID;          // child relation UUID, or cref:relationID
  relevance; argument; virtualType;
};
```

### KnowNode / TextNode become unnecessary

Nodes were just `{id: hash, text: string}`. With text on the Relation, the separate Node type goes away. Content hashes (`textHash`) remain as a **computed index** for:
- Occurrence detection ("where else does this text appear?")
- Nostr `#n` tags for query filtering
- URL navigation (`/n/Parent/Child` → hash-based lookup)

### ViewPath simplifies

```typescript
// BEFORE: [paneIndex, {nodeID, nodeIndex, relationsID}, ..., {nodeID, nodeIndex}]
// AFTER:  [paneIndex, relationID, relationID, ...]
```

Just a pane index and a flat list of relation UUIDs. No `nodeIndex`, no separate `relationsID`.

### Tree traversal simplifies

```typescript
// BEFORE (treeTraversal.ts:69-92)
function getChildrenForRegularNode(data, parentPath, parentNodeID, stack, ...) {
  const effectiveAuthor = getEffectiveAuthor(data, parentPath);
  const context = getContext(data, parentPath, stack);
  const relations = getRelationsForContext(knowledgeDBs, effectiveAuthor, parentNodeID, context, ...);
  // ...
}

// AFTER
function getChildrenForRelation(data, parentRelation) {
  return parentRelation.items.map(item =>
    data.knowledgeDBs.get(item.relationID)  // direct lookup
  );
}
```

### Multi-author: suggestions, versions, occurrences — unchanged

The suggestion mechanic and all virtual item UI stays exactly as-is. The only change is the internal lookup:
- Currently: `getSuggestionsForNode()` matches across authors by `(head hash, context)`
- After: matches across authors by `textHash` at the same tree position
- Same result, same UI, just different key for the cross-author lookup

### Markdown format: almost unchanged

The current markdown format already uses UUIDs per item:
```markdown
# Root Text {uuid1}
- Child Text {uuid2 .relevant}
  - Grandchild {uuid3}
```

The serializer/parser already maps UUIDs → Relations. The only change: `materializeTreeNode` creates `RelationItem.relationID` instead of `RelationItem.nodeID: hash`.

---

## What Stays the Same

- **Crefs** simplify: `cref:relationID:targetNode` becomes just `cref:relationID` — every child has its own relation UUID, so no need for the `:targetNode` suffix. To display: look up `relation.parent` to find what to open, scroll to the child relation.
- **Nostr events** — `KIND_KNOWLEDGE_DOCUMENT` format barely changes; `#n` tags still use content hashes
- **PublishQueue** — unchanged
- **Plan/Execute pattern** — unchanged, just updates relation fields
- **Virtualization / react-virtuoso** — unchanged
- **DnD, keyboard navigation** — work with ViewPaths (which get simpler)

---

## Content Hashes: From Identity to Index

Content hashes don't disappear — they shift from **primary identity** to **read-only index**:

| Use | Before | After |
|-----|--------|-------|
| Tree structure | Primary (head, items.nodeID) | UUID-based (parent, items.relationID) |
| Occurrence detection | By hash lookup | Same — `textHash` field |
| Nostr query tags | `#n` = hash | Same |
| URL navigation | `/n/Parent/Child` → hashes | Same — compute hash from text |
| Deduplication | "Apple (1)" variants | Not needed — UUIDs are unique |
| Cross-doc linking | crefs | Same |

---

## Decisions

- **Approach**: Incremental, one session, with a strict green gate after every step.
- **Compatibility**: No backward compatibility required for old data/path formats.
- **Node model**: Relations absorb text. `KnowNode` is removed once relation-first paths are complete.
- **Dedup behavior**: Keep current dedup/collision behavior during refactor so existing tests keep passing; remove dedup/collision logic as the final step so exact duplicates are allowed.

---

## Execution Plan

### Step 1: Baseline

- Run full gate to confirm starting point is green:
  1. `npm run typescript`
  2. `npm run lint`
  3. `npm test -- --runInBand`

### Step 2: Add relation-native fields

- Add `Relations.text`, `Relations.textHash`, `Relations.parent`.
- Populate these in all relation creation/update paths (`newRelations`, markdown materialization, planner upserts).
- Keep behavior unchanged.
- Run full gate.

### Step 3: Make markdown/document flow relation-first

- Parser/materializer/serializer reads and writes relation text directly.
- Keep output behavior equivalent from test perspective.
- Run full gate.

### Step 4: Hard switch child pointers

- Replace regular child usage of `RelationItem.nodeID` with a relation ID field (`RelationItem.id`).
- Update traversal/planner/move/copy/virtual-item logic in one pass (no fallback compatibility code).
- Keep cref/search semantics intact.
- Run full gate.

### Step 5: Hard switch ViewPath model

- Replace `nodeIndex`/`relationsID` path shape with relation-ID pathing.
- Rewrite `parseViewPath`, path serialization, parent/sibling/index helpers.
- Run full gate.

### Step 6: Planner and DnD rewrite to parent-relation semantics

- Move/copy/disconnect/delete descendants through `parent` relation links.
- Remove reliance on `(head, context)` relation discovery in edit paths.
- Run full gate.

### Step 7: Remove node-map dependence

- Stop using `KnowledgeData.nodes` for display/search/navigation.
- Build search and occurrence inputs from relations (`text`, `textHash`) instead.
- Run full gate.

### Step 8: Delete legacy model

- Remove legacy model pieces once unused:
  - `KnowledgeData.nodes`
  - `NodeIndex`
  - old query helpers (`getRelationsForContext`-style lookups)
  - legacy knowledge node/list event paths
- Keep only document-event model.
- Run full gate.

### Step 9: Remove dedup/collision behavior (required)

- Remove collision renaming logic in normal editing (`resolveCollisions`, `findUniqueText` dedup path).
- This is intentionally last so architectural refactor can stay green independently before behavior changes.
- Run full gate.

---

## Verification

After each step, require:
1. `npm run typescript`
2. `npm run lint`
3. `npm test -- --runInBand`

After Step 9, also perform:
1. Manual duplicate check: create 5 siblings with identical text, verify no forced renaming.
2. Manual tree ops check: edit/move/copy/delete on duplicated siblings.
3. Manual refs/versions check: cref navigation, incoming refs, versions list still work.
