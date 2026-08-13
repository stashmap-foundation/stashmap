# We are introducing an occurrence layer between the persisted graph and the UI rows.

The persisted graph remains the exact structure parsed from Markdown.

It describes which lines are physically in each file, their file order, their physical parents, their markers, their links, and their attributes.

We keep that graph literal because it must serialize back to the same Markdown without mixing in foreign or calculated content.
The occurrence layer represents the document after embeds have been resolved and the reader’s changes have been applied.

An occurrence means one visible showing of a node in one particular place.

When an embed is resolved, its source text and children enter the occurrence graph without being copied into the reader’s persisted file.

If the same source node is embedded twice, the occurrence graph contains two independent showings of it.

The persisted graph cannot represent those showings because it contains only the explicit lines that were actually written.
Every occurrence knows whether it represents the user’s own row, a saved embed line, or an untouched row projected from a source.

For the user’s own row, it knows which persisted line can be edited directly.

For a saved embed, it knows both the persisted placement line and the source line whose live content it displays.

For an untouched projected row, it knows that no local line exists yet and where such a line must be created when the user touches it.

It also knows the exact source showing represented by from=, its physical fallback position in the file, and its effective parent and children on screen.
All user operations are addressed to occurrences rather than asking UI code to interpret raw GraphNode values.

The planner no longer needs separate paths for real rows, embeds, projected rows, calendar entries, and materialized rows.

It reads the occurrence and reduces the user’s action to a few persisted operations: create a line, update a line, move a line, delete a line, or change its attributes.

Positioning is resolved once inside the occurrence layer, after all embeds and diff rows are known, so the planner never tries to reproduce composition rules.

After a persisted operation is applied, the old occurrence graph is discarded and rebuilt from the updated persisted graphs.

Rows therefore become thin UI objects around occurrences, while GraphNode remains the storage format and the occurrence layer becomes the single meaning of what the user currently sees and touches.

# How we execute the refactor

## A. Delete the current implementation first

We start by removing the complete Phase 3.4b production implementation from this branch. We keep all tests and corpus fixtures because they describe the behavior the replacement must preserve.

In practice, production code returns to the Phase 3.4a state while the newer tests remain. We do not keep the current composer, position helpers, gesture routing, or materialization code as temporary fallbacks. Otherwise, the new design would grow beside the old one and we would repeat the same architectural mistake.

This deletion includes:

- the current composition implementation;
- position handling spread across several passes;
- the separate projected-row and materialization paths;
- the new planner branches that special-case embeds;
- duplicate move, reorder, indent, and outdent implementations;
- compatibility fields and helpers that exist only for the current design;
- dead code and review scratch files added by the branch.

Generic Markdown parsing and writing code may be rebuilt as needed, but no composition behavior survives merely because it is convenient to reuse.

The retained tests will initially fail. That is expected: they are the specification for the replacement. TypeScript, lint, and unaffected tests should still be run throughout the rewrite so unrelated behavior does not break silently.

The reason for deleting first is simple: we need to prove the new occurrence layer can stand on its own. If old paths remain available, every difficult case will be “temporarily” routed through them, and the temporary split will become permanent again.

## B. Introduce the occurrence layer before resolving embeds

Next, we introduce the occurrence layer in its simplest possible form.

At first, each persisted `GraphNode` produces one occurrence with the same text, marker, parent, children, and order. The occurrence layer does not yet resolve embeds or change the visible result. Its first job is only to establish the new direction of the application:

```text
Markdown
→ persisted graph
→ occurrence graph
→ tree traversal
→ UI rows
```

`treeTraversal` must begin reading content from occurrences rather than walking `GraphNode.children` directly. This is important even while the occurrence graph still looks identical to the persisted graph. It makes the occurrence layer the only source of visible content before we add difficult behavior to it.

A content row points to an occurrence. It does not independently decide what its `GraphNode` means. During the migration, old row fields may exist only as temporary access to data already held by the occurrence; they must not contain a second interpretation of the row.

The occurrence initially records enough information for later work:

- the effective text and marker shown on screen;
- the persisted line, when this occurrence comes from the user’s file;
- the source line that supplies its content;
- its physical parent and file order;
- its effective parent and children;
- where a local line must be written if the occurrence has not been persisted yet;
- the source showing named by `from=`;
- any composition flags.

A user-owned row initially has the same persisted line and source line. A projected occurrence will later have a source line but no local persisted line. A saved embed will have both a persisted placement line and a separate source line.

The occurrence graph may use temporary internal keys to distinguish separate showings of one source node. Those keys exist only during composition and never enter Markdown, links, position attributes, or view state. Existing `ViewPath` values continue to handle folding, focus, and selection.

At the end of this step, ordinary non-embed documents must render through the occurrence layer exactly as they did through the persisted graph.

## C. Resolve embeds completely in the occurrence layer

Once the UI reads occurrences, we implement embed resolution there.

An embed remains one literal line in the persisted graph. The occurrence builder resolves its target and creates a complete visible occurrence from the source’s current text and children. The projected source content enters only the occurrence graph and is never copied into the user’s Markdown.

If one source row is embedded twice, the builder creates two independent occurrences. They share the same source identity, but each showing can have its own marker, wording, dismissal, children, order, and position.

The occurrence builder must support every existing embed form:

- embeds at document roots;
- embeds nested anywhere in a document;
- recursive embeds across several documents;
- repeated embeddings of the same source;
- missing targets;
- embed cycles;
- local markers and dismissals;
- rewordings;
- merge rewordings;
- evidence rows;
- local additions;
- adoption and consumption;
- calendar-feed projections;
- rows moved out of an embed with `from=`;
- arrangements applied at source boundaries.

Composition follows a simple order.

First, build the projected source occurrences. Then read each explicit row in the user’s diff once and apply the content stated by that row. A diff row may change a marker, replace wording, dismiss an occurrence, add a new occurrence, or represent one projected source showing.

A saved placement consumes the source showing it represents while leaving other showings untouched. When the placement remains physically beneath its embed, its written containment identifies the showing. When it has been moved elsewhere, `from=` identifies the original showing. A broken `from=` consumes nothing.

Position attributes are only recorded while the diff is being read. They do not move rows yet.

After all source rows, recursive embeds, and diff rows are present, the occurrence layer resolves positioning exactly once. It examines each row’s `after`, `before`, and `parent` names in written order and chooses the first name that still identifies one living occurrence in the correct embed scope.

The selected relationship is stored as one attachment:

- before another occurrence;
- after another occurrence;
- first child of a parent;
- last child of a parent.

Rows attached to another row travel with that row automatically. If every name is dead, the occurrence stays at its physical Markdown fallback position and is marked lapsed. If selected position relationships form a cycle, the affected rows keep file order.

The final visible tree is then produced once from these attachments. There is no earlier partial placement, later relocation, second anchor pass, or final duplicate-pruning pass.

At the end of this step, every read-only composition and embed test must pass through the occurrence layer. `treeTraversal` must not resolve embeds, choose live text, consume source rows, or apply positions itself.

## D. Rewrite every user operation to use occurrences

After reading is correct, every content operation is rewritten to act on occurrences.

The planner still writes `GraphNode` changes because `GraphNode` remains the persisted Markdown format. What changes is how the planner understands the user’s action.

The planner receives the occurrence the user touched. That occurrence already knows whether it is:

- a user-owned persisted row;
- a saved embed placement;
- an untouched projected source row;
- a computed calendar occurrence;
- one particular showing of a source that appears several times.

The planner therefore does not need separate code paths for those cases.

For a user-owned row, the occurrence points directly to the persisted line to update. For a saved embed, it points to the placement line to update and the source line it represents. For an untouched projection, it says that no local line exists yet and identifies the persisted write scope where one must be created.

Each user action is reduced to a small set of persisted operations:

- create a line;
- update a line’s spans or marker;
- move a physical line to its fallback parent;
- set or remove attributes;
- delete a line.

The planner never mutates the occurrence graph. It writes the smallest persisted change that states the user’s action, discards the old occurrence graph, and composes again from the updated Markdown truth.

Every operation must migrate, including:

1. judgments;
2. dismissals;
3. rewording;
4. adding children and siblings;
5. drag-and-drop placement;
6. move and reorder;
7. multiselect movement;
8. indent and outdent;
9. keyboard movement;
10. deletion;
11. calendar-entry materialization;
12. incoming-reference acceptance.

Each operation is migrated completely. In the same checkpoint that moves an operation to occurrences, its old `Row.node`, `projected`, or `materialize` path is deleted. No operation may keep a fallback to the previous implementation.

Move operations use the effective parent and visible neighbors from the occurrence graph. The planner converts the drop into `after`, `before`, and `parent` attributes and updates the row’s physical fallback location. It does not calculate where the row will render; the next occurrence build does that.

Indent and outdent are ordinary moves and must use the same code. Calendar entries are ordinary projected occurrences and must use the same create or move operations. Touching an untouched projection creates its placement through the same path regardless of whether the source came from Markdown, another author, or a feed.

After all operations have migrated, content rows become thin UI wrappers around occurrences. The following fields and concepts must disappear as independent sources of meaning:

- optional `Row.composed`;
- `Row.node` as the displayed content authority;
- `projected`;
- `standsFor`;
- `materialize`;
- UI embed interpretation;
- planner embed interpretation;
- separate projected-row mutation recipes.

Virtual rows such as empty editors, incoming-reference prompts, and action buttons may remain separate row variants. Once a virtual action creates content, that content appears as an occurrence after recomposition.

# Why this order matters

The occurrence layer must own reading before it owns writing. Otherwise, planner code would be rewritten against an incomplete representation and would start rebuilding missing composition rules itself.

Embed resolution must be complete before gestures migrate. Otherwise, some operations would still receive raw graph rows while others receive resolved occurrences.

Operations migrate one at a time so each old path can be deleted immediately. The final design must not contain a permanent transition layer where both systems remain valid.

The finished data flow is:

```text
Persisted Markdown graphs
→ build complete occurrence graph
→ create UI rows from occurrences
→ perform a user action on an occurrence
→ translate it into basic persisted graph changes
→ rebuild the occurrence graph
```

There is no general occurrence-graph-to-Markdown conversion. The occurrence graph contains projected foreign content and calculated structure that must never be persisted. Only explicit user operations create small changes in the user’s persisted graph.

# Acceptance criteria

## Behavior

- All existing tests pass.
- The complete composition corpus passes byte-for-byte.
- All UI integration tests pass through the real occurrence layer.
- Every gesture works on owned rows, saved embeds, untouched projections, recursive embeds, and calendar occurrences where applicable.
- Save-and-reload tests prove that persisted Markdown remains the only source of truth.
- TypeScript, lint, and the full test suite pass without skipped replacement tests.

## Architecture

- Content reaches `treeTraversal` only through the occurrence layer.
- Content rows use occurrences as their single source of visible meaning.
- The UI does not resolve embeds or interpret position attributes.
- The planner does not resolve embeds, calculate final positions, or rebuild source relationships.
- Positioning is resolved once, after the complete occurrence graph exists.
- There is one write path for every user operation.
- There is one move implementation shared by drag, reorder, indent, outdent, keyboard movement, and multiselect.
- Projected content is never inserted into the persisted graph unless a user action explicitly creates a placement.
- The occurrence graph is rebuilt after persisted changes and is never used as persisted input.
- The old composition, materialization, and planner paths are deleted rather than retained behind runtime checks.

## Coding standards

- No new casts or non-null assertions are introduced.
- No lint rules are disabled to make the design compile.
- No explanatory comments are added to compensate for complicated code.
- No dead fields, dead result data, unused helper types, or scratch review files remain.
- No duplicate parser, composer, position, or gesture logic remains.
- Optional fields are used only for real domain states, such as an untouched projection having no persisted reader line.
- The final implementation uses plain data and small functions rather than managers, registries, classes, or caches.

## Size

- Production lines of code are counted before demolition and after completion.
- Tests, fixtures, generated files, and `dist` are excluded from that count.
- The completed implementation contains fewer production lines than the current `phase-3.4b-rewrite` branch.
- The reduction must come from removing duplicate and obsolete machinery, not from deleting unrelated product behavior.

The refactor is complete only when the occurrence path is the sole path. A passing suite with the old machinery still present does not satisfy these criteria.
