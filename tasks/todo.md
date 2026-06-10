# Multi-Root Document Finalization Execution Plan

Status: **Completed/historical.** This was the execution plan for the `f/multi-root-fix` branch; that work landed and the branch no longer exists. All implementation phases (1–7b) are done; only the Phase 8 cleanup checkboxes were never ticked. Kept for the phase review notes. Current work lives in `implementation.md`.

## Current Branch And Scope

- Branch: `f/multi-root-fix`
- Feature base commit: `0ac21fe`
- Compare against: `master`
- This branch already contains the broad multi-root migration. The remaining work is to make the changed model correct and mergeable.
- Do not expand into new product features: no title editing UI, no explicit file rename policy, no zero-root document UX unless a failing existing flow requires it.

## Definition Of Done

A markdown file with multiple top-level roots behaves like one document container:

- Every top-level root can be edited and saved.
- Child edits under any root persist to the same file.
- Deleting one root keeps the file when other roots remain.
- Reordering roots changes file order without creating refs or wrapper nodes.
- Relative file links resolve from the containing file for every root.
- Top-level file-link roots produce document links and incoming refs.
- `/d/...` opens the document overview; `/r/...` opens a graph node with a document breadcrumb when applicable.
- Multi-root markdown imports do not create synthetic wrapper roots.

---

## Phase 0 — Baseline And Guardrails

### Tests / checks

- [ ] Confirm branch and diff:
  - [ ] `git status --short --branch`
  - [ ] `git diff --stat master...HEAD`
- [ ] Run current focused baseline before edits:
  - [ ] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand`
  - [ ] `npm test -- src/core/Document.test.ts src/editor/MarkdownImportPlan.test.tsx --runInBand`

### Implementation

- [ ] Do not touch root untracked `done.md` / `todo.md`.
- [ ] Keep changes grouped by phase so failures are easy to isolate.

### Acceptance

- [ ] We know which existing focused tests pass/fail before modifications.

---

## Phase 1 — Establish The Document Membership Invariant

Problem: `parseToDocument` gives `docId` only to the first top-level root, so later roots cannot find their document for save/link/delete/breadcrumb logic.

### Tests first

- [x] Add `src/core/Document.test.ts`: parsing `# First\n\n# Second` returns a document whose two top-level nodes both have the same `docId`.
- [x] Add/update `src/editor/MultiTopNodeDocuments.test.tsx`: editing a child under the second top-level root persists to the same markdown file.
- [x] Add/update `src/editor/MultiTopNodeDocuments.test.tsx`: editing the second top-level root text persists to the same markdown file.

### Implementation

- [x] In `src/core/Document.ts`, change `parseToDocument` so every visible top-level tree gets `docId: ensured.docId`.
- [x] Keep `systemRole` behavior constrained to the system root/document as currently intended; do not use `systemRole` to decide document membership.
- [x] Add a small helper for resolving document membership from a node without duplicating logic. Prefer a new core helper file if importing `getNode` into `Document.ts` would worsen cycles.
  - Input: `knowledgeDBs`, `documents`, `node`.
  - Logic: `node.docId ?? rootNode.docId`, then `documentKeyOf(node.author, docId)`.
- [x] Replace duplicated ad-hoc membership lookup in changed code where it directly checks only `rootNode.docId`.

### Acceptance

- [x] New core membership test fails before the implementation and passes after.
- [x] Editing under a second root writes the original file, not a new document/file.

### Focused verification

- [x] `npm test -- src/core/Document.test.ts src/editor/MultiTopNodeDocuments.test.tsx --runInBand`

---

## Phase 2 — Deleting Top-Level Roots Must Update The Document, Not Delete It Prematurely

Problem: root deletion currently treats any root with `docId` as deleting the whole document. After Phase 1, that would make deleting any top-level root dangerous.

### Tests first

- [x] Add integration test: deleting the first root from `# First\n\n# Second` leaves only `# Second` in the same file.
- [x] Add integration test: deleting the second root leaves only `# First` in the same file.
- [x] Add integration test: deleting the last root removes the document/file, or if current app semantics cannot remove the visible file immediately, emits a document delete and no longer renders the document.

### Implementation

- [x] In `src/core/plan.ts`, update `planDeleteNodes`:
  - [x] If deleting a top-level document root and other `topNodeShortIds` remain, remove only that short id from the document.
  - [x] Set `updatedMs` on the document and add `docId` to `affectedDocuments`.
  - [x] Do not add the document to `deletedDocs` when other roots remain.
  - [x] If no roots remain, remove the document and add `docId` to `deletedDocs`.
- [x] Keep `documentByFilePath` in sync wherever document metadata changes.
- [x] In `src/treeMutations.ts`, keep a document pane open after deleting one root if the document still exists.

### Acceptance

- [x] Deleting one root rewrites one markdown file with the remaining roots.
- [x] Deleting one root does not create a Nostr/file delete unless it was the last root.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand`

---

## Phase 3 — Top-Level Root Metadata And Text Edits

Problem: document top-level rows render as root view paths, and root rows are normally readonly. Relevance/argument/text updates need a document-pane exception.

### Tests first

- [x] Add integration test: setting relevance on the second top-level root persists as `# (!) Second`.
- [x] Add integration test: setting argument on a top-level root persists the expected marker.
- [x] Add integration test: editing top-level root text in a document pane persists and keeps the same node id.

### Implementation

- [x] In `src/editor/RightMenu.tsx`, allow relevance/evidence controls for document top-level rows while keeping normal standalone roots readonly.
- [x] In `src/editor/useNodeItemContext.ts`, treat `pane.documentId && isRoot(viewPath)` as editable top-level document row.
- [x] In `src/nodeItemMutations.ts`, when `parentView` is absent but the current row is a document top-level node, update the node itself via `planUpsertNodes` / text update rather than returning unchanged.
- [x] Ensure text updates use existing `planUpdateNodeText` behavior so user-public-key side effects remain intact.

### Acceptance

- [x] Top-level metadata updates mark the containing document affected.
- [x] Standalone root readonly behavior outside document panes is unchanged.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand`

---

## Phase 4 — File Links And Incoming Refs For Every Root

Problems:

- Relative file links under non-first roots can resolve as deleted because the source root lacks document membership.
- File links on a top-level root are not indexed as incoming document refs.
- Several link helpers choose a target root by scanning `node.docId`, which is unstable for multi-root documents.

### Tests first

- [x] Add integration test: `[Open B](./b.md)` under the second root in `docs/a.md` navigates to `docs/b.md` and shows incoming ref from the second root.
- [x] Add integration test: top-level file-link root `[Holidays](./holidays.md)` renders as `[R] Holiday Destinations` and shows incoming ref on `holidays.md`.
- [x] Add reload assertion for copied/dragged file links so they remain document links, not deleted graph refs.

### Implementation

- [x] In `src/editor/linkOperations.ts`, source file path lookup must use document membership for the source node.
- [x] In `src/buildReferenceRow.ts` and `src/core/connections.tsx`, resolve target document display root via `targetDocument.topNodeShortIds[0]`, not by scanning arbitrary nodes with matching `docId`.
- [x] In `src/graphIndex.ts`, index links on the node itself as well as links in children:
  - [x] top-level graph links update `incomingCrefs`.
  - [x] top-level file links update `incomingFileLinks`.
  - [x] removal mirrors addition.
- [x] In `src/treeTraversal.ts` / `src/semanticProjection.ts`, when computing document-level incoming refs, consider all document descendants as already-covered document links, not only immediate top nodes.

### Acceptance

- [x] File links work from every root in a multi-root document.
- [x] Top-level file-link roots produce incoming refs at document level.
- [x] Existing child file-link behavior still works.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx --runInBand`

---

## Phase 4b — Link Direction Display Fix

Problem: bidirectional graph refs currently split endpoint paths around `<<< >>>`, which makes `Holiday Destinations / Spain` look like a relation between `Holiday Destinations` and `Spain`. Accepted incoming refs are also only displayed as bidirectional from one side.

### Tests first

- [x] Add one integration test with exactly:
  - `Holiday Destinations` → `Spain` → `Barcelona`
  - `Southern European Countries` → `[Spain]`
  - Verify source side before accepting: `Holiday Destinations / Spain >>>`
  - Verify target side before accepting: `Southern European Countries <<<` aligned as a child beside `Barcelona`
  - Accept the incoming ref with `!`
  - Verify target side after accepting: `{!} Southern European Countries >>> <<<` because outgoing relevance stays in the gutter
  - Verify source side after accepting: `Holiday Destinations / Spain >>> !<<<` because the remote incoming side carries `!`

### Implementation

- [x] Change reference text rendering so relationship markers are suffixes after the complete endpoint label, without brackets.
- [x] Keep arrow spans formatted through the existing reference-part rendering path.
- [x] Fix bidirectional detection so the reverse relation is recognized from both endpoint views.
- [x] Ensure incoming-link lookup goes through the graph index; do not add any full DB scans for incoming links.

### Acceptance

- [x] Only the new focused test is updated to the new notation in this slice.
- [x] Existing broad tests may remain old-notation until the user tries the UX manually.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand -t "Bidirectional graph link labels keep endpoint paths intact"`

## Phase 4b Review

- Added the exact Holiday Destinations / Spain / Barcelona and Southern European Countries regression from both sides.
- Rendered reference direction markers as suffixes after the complete endpoint label.
- Kept outgoing relevance in the gutter; only incoming relevance appears in the suffix marker.
- Changed the existing incoming graph-link index to store link item IDs, and consumers derive source owners by lookup.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand -t "Bidirectional graph link labels keep endpoint paths intact"`
  - `npm run lint`
  - `npm run typescript`

## Phase 4c — Adopt New Link Direction Notation Everywhere

Problem: the new suffix direction notation works manually and in the focused regression, but existing tests still assert the old display. File-link flows need explicit confirmation too.

### Tests first

- [x] Run focused link suites to collect expected failures:
  - [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx src/editor/IncomingRefInteraction.test.tsx --runInBand`
- [x] Update existing expectations to the suffix notation.
- [x] Ensure file-link incoming acceptance tests cover both sides with the new notation.

### Implementation

- [x] Keep code changes minimal; prefer expectation updates unless behavior is wrong.
- [x] If file-link behavior is wrong, fix through the same reference rendering/index path rather than special-casing display strings.

### Acceptance

- [x] Focused link suites pass.
- [x] Lint and TypeScript pass.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx src/editor/IncomingRefInteraction.test.tsx --runInBand`
- [x] `npm run lint`
- [x] `npm run typescript`

## Phase 4c Review

- Updated broad graph-link, incoming-ref, search, drag/drop, and file-link expectations to the suffix notation.
- Confirmed file-link accepted incoming rows use the same bidirectional suffix behavior as graph links.
- Fixed document-root file-link bidirectional detection by resolving indexed incoming rows through the document root when the view has no parent path.
- Kept version detection limited to real parent rows so top-level graph-link roots do not collapse into `[V]` rows.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx src/editor/IncomingRefInteraction.test.tsx --runInBand`
  - `npm test -- src/dnd.test.tsx src/editor/DeepCopy.test.tsx --runInBand -t "dragging a search result|Alt-dragging a reference keeps it as a reference"`
  - `npm run lint`
  - `npm run typescript`
  - `npm test -- --runInBand`

## Phase 5 — Breadcrumbs And Routes

Problem: `/d/...` panes know the document, but `/r/...` panes for document roots often do not show the document container breadcrumb.

### Tests first

- [x] Add integration test: route to the second root by `/r/:nodeId`; breadcrumb shows document name first.
- [x] Add integration test: clicking the document breadcrumb switches to document overview and renders all top-level roots.
- [x] Add regression: when document title/name equals first root text, breadcrumbs do not show duplicate adjacent labels and the remaining visible first breadcrumb still opens the document overview.

### Implementation

- [x] In `src/editor/Workspace.tsx`, derive `document` from `pane.documentId` first, otherwise from the current/root node membership helper.
- [x] Keep document breadcrumb target as `/d/:author/:docId` and pane state as `{ documentId, rootNodeId: undefined, searchQuery: undefined }`.
- [x] Keep graph breadcrumb entries targeting `/r/:nodeId`.
- [x] Keep duplicate-label suppression in `breadcrumbEntriesWithDocument`.

### Acceptance

- [x] `/r/...` remains a graph node route but shows document context when applicable.
- [x] `/d/...` remains document overview.

### Focused verification

- [x] `npm test -- src/navigationUrl.test.ts src/editor/MultiTopNodeDocuments.test.tsx --runInBand`

## Phase 5 Review

- Added graph-route breadcrumb coverage for second top-level document roots.
- Added document breadcrumb click coverage from `/r/...` routes back to `/d/...` document overview.
- Added duplicate-label regression where the document title equals the first root label; the visible `First` breadcrumb remains the document breadcrumb and opens the overview.
- Implemented breadcrumb document context by falling back from `pane.documentId` to `getDocumentForNode` on the routed/current graph node.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand -t "Graph route|Document breadcrumb"`
  - `npm test -- src/navigationUrl.test.ts src/editor/MultiTopNodeDocuments.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

---

## Phase 6a — Guard Document Top-Level Roots In DnD

Problem: full top-level root reorder/move semantics are structural and risky. For branch finalization, document panes should keep multi-root documents displayable/editable without allowing accidental top-level DnD mutations.

### Tests first

- [x] Add integration test: dragging one document top-level root after another does not reorder markdown and creates no `[R]`/`[I]` rows.
- [x] Add integration test: dragging a document top-level root under another root is ignored.
- [x] Add integration test: dragging a child to document top level is ignored.
- [x] Add integration test: dragging an external node/reference onto the document root is ignored, so no new top-level root is added.
- [x] Keep/update integration coverage that safe child-level drops in document panes still work.

### Implementation

- [x] In `src/dnd.tsx`, detect document-pane root drop targets and block top-level insertions.
- [x] In `src/dnd.tsx`, detect document-pane top-level sources and block structural moves/reorders into the same document pane.
- [x] Preserve explicit reference creation from document roots into non-document targets and existing child-level drops.
- [x] Do not implement `Document.topNodeShortIds` reordering in this phase.

### Acceptance

- [x] Reordering/moving/adding document top-level roots via DnD is a no-op.
- [x] Child-level DnD inside document roots still works.
- [x] External refs/links can still be dropped under document child rows.

### Focused verification

- [x] `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/dnd.test.tsx --runInBand`

## Phase 6b — Reorder And Move Document Top-Level Roots Later

Deferred: implement explicit, well-tested document-top-level editing semantics in a separate slice if/when needed. That future phase must update `Document.topNodeShortIds` intentionally instead of relying on ordinary graph DnD.

## Phase 6a Review

- Added integration guardrails for ignored document top-level root drops, ignored top-level-root-to-child drops, ignored child-to-document-root drops, and preserved child-level DnD.
- Strengthened the existing document-pane drop test to prove dropping onto the document root does not rewrite the markdown or add a top-level root.
- Implemented a focused DnD guard that blocks structural drops only when the source is one of the current document's top roots in the same document pane, or when the resolved drop target is the document root.
- Preserved accepted behavior for virtual/document-level incoming rows and for explicit refs from document roots into non-document targets.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand -t "Dragging document top-level|Dragging a document top-level|Dragging a child|Child-level drag|Dropping onto"`
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/dnd.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

---

## Phase 7 — Remove Synthetic Wrapper Imports

Problem: multi-root markdown import still wraps roots under a synthetic filename/title root.

### Tests first

- [x] Add/update `src/editor/MarkdownImportPlan.test.tsx`: importing a file with two top-level headings produces two top-level roots, not a wrapper root.
- [x] Add/update frontmatter-title import coverage so titles stay metadata and do not become synthetic roots.
- [x] Add/update planning coverage so a single imported multi-root file returns multiple top nodes in source order.
- [x] Keep single-root import behavior covered.

### Implementation

- [x] In `src/core/markdownImport.ts`, remove `normalizeRootsForSingleFile` wrapper behavior.
- [x] Return parsed top-level trees directly.
- [x] Verify `planCreateNodesFromMarkdownTrees` creates documents only when expected by caller.

### Acceptance

- [x] No synthetic filename/title wrapper root appears for single-file multi-root imports.
- [x] Existing paste/upload flows still work.

### Focused verification

- [x] `npm test -- src/editor/MarkdownImportPlan.test.tsx src/editor/MarkdownUpload.test.tsx --runInBand`

## Phase 7 Review

- Updated markdown import parsing tests so a single file with multiple top-level roots returns those roots directly.
- Updated frontmatter-title coverage so titles remain metadata and do not create synthetic wrapper roots.
- Added planning coverage that a single imported multi-root markdown file produces multiple top nodes in source order.
- Removed the filename/title wrapper normalization from `parseMarkdownImportFiles`; it now returns parsed top-level trees directly.
- Verification passed:
  - `npm test -- src/editor/MarkdownImportPlan.test.tsx --runInBand -t "Single file with multiple|Front matter|Imported front matter|Planning one markdown file"`
  - `npm test -- src/editor/MarkdownImportPlan.test.tsx src/editor/MarkdownUpload.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

---

## Phase 7b — Native Markdown File Drops Preserve File Boundaries

Problem: native markdown file drops into an empty pane merged all dropped files under a fake `Imported Markdown Files` graph root and routed to `/r/Imported%20Markdown%20Files`, which is not a concrete node id.

### Tests first

- [x] Add planning coverage: dropping one markdown file into an empty pane creates one document with all roots from that file and opens the pane as a document route.
- [x] Add planning coverage: dropping multiple markdown files creates one document per file plus an `Imported Files` wrapper document containing document links to each imported file document.
- [x] Add serialization coverage: wrapper document links round-trip as file-link spans to imported document ids.
- [x] Add parser coverage: knowstr document-id links parse as file links so generated wrapper markdown can round-trip.

### Implementation

- [x] Add `planImportMarkdownFilesAtEmptyRoot` in `src/editor/FileDropZone.tsx` for native empty-pane imports.
- [x] Single file: parse it as one document using the file name as fallback title, preserve every top-level root in that document, and set pane state to `{ documentId }` rather than `/r/...`.
- [x] Multiple files: parse each file as a separate document with `File.name` as its relative file path, create a real `Imported Files` document, and add document-link child rows to the imported documents.
- [x] Keep row-drop behavior separate: dropping markdown onto an existing row still flattens parsed trees for paste semantics.
- [x] Remove empty-root native drop usage of the synthetic `Imported Markdown Files` tree and `topItemIDs[0]` route materialization.

### Acceptance

- [x] No native empty-pane drop produces `/r/Imported%20Markdown%20Files`.
- [x] Single-file drops preserve document boundaries and all roots from that file.
- [x] Multi-file drops preserve file boundaries through separate imported documents and a real wrapper document.

### Focused verification

- [x] `npm test -- src/editor/MarkdownImportPlan.test.tsx --runInBand`
- [x] `npm test -- src/editor/MarkdownImportPlan.test.tsx src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx --runInBand`
- [x] `npm run lint`
- [x] `npm run typescript`
- [x] `npm test`

## Phase 7b Review

- Implemented empty-pane native markdown imports as document imports rather than graph-root markdown paste.
- Single native markdown drops now open a document pane containing all roots from the file.
- Multiple native markdown drops now create one document per file and an `Imported Files` document containing file-link/document-link rows to them.
- Imported file documents use `File.name` as their available relative file path, while wrapper links use durable document ids so generated wrapper documents survive event round-trips.
- Kept existing row-drop markdown behavior using flattened `parseMarkdownImportFiles` trees.
- Added UUID-style document-id links to markdown file-link parsing so wrapper documents can be serialized and parsed back.
- Adjusted breadcrumb tests to reflect the Phase 5 decision that document-root breadcrumbs open `/d/...` document routes.
- Verification passed:
  - `npm run lint`
  - `npm run typescript`
  - `npm test`

---

## Phase 8 — Regression, Cleanup, And Merge Readiness

### Tests / checks

- [x] `npm run typescript`
- [x] `npm run lint`
- [x] `npm test`
- [x] `git diff --check`

### Cleanup

- [ ] Revert unrelated `CLAUDE.md` changes unless explicitly requested.
- [ ] Remove stale task/doc churn that should not be part of the feature diff.
- [ ] Remove debug logging and unused helpers.
- [ ] Review final diff by layer:
  - [ ] core document/markdown/plan
  - [ ] editor document pane/navigation/dnd
  - [ ] filesystem persistence/watcher
  - [ ] Nostr event parsing/rendering
  - [ ] tests

### Final review notes

- [ ] Summarize implemented behavior.
- [ ] List explicitly deferred non-blockers, if any.

---

## Phase 1 Review

- Added failing-then-passing coverage for shared `docId` assignment across top-level roots and for edits under/on a second top-level root persisting to the original markdown file.
- Implemented `getDocumentForNode` and used it for source file path lookup.
- Adjusted document-link/root selection helpers touched by the new invariant so primary document links keep using `topNodeShortIds[0]` instead of arbitrary `docId` scans.
- Verification passed:
  - `npm test -- src/core/Document.test.ts src/editor/MultiTopNodeDocuments.test.tsx --runInBand`
  - `npm test -- src/editor/FileLinks.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

## Phase 2 Review

- Added integration coverage for deleting the first root, second root, and final root from markdown documents.
- Updated `planDeleteNodes` so deleting one document root updates `topNodeShortIds` and rewrites the same file, while deleting the last root removes the document/file.
- Kept `documentByFilePath` synchronized when document metadata is updated or removed.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

## Phase 3 Review

- Added integration coverage for top-level document-root relevance, argument, and text edits preserving node IDs.
- Allowed right-menu controls on top-level rows only when they belong to a document pane.
- Routed no-parent document top-level metadata changes through node updates so they mark the document affected and persist to markdown.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`

## Phase 4 Review

- Added integration coverage for relative file links under the second top-level root, top-level file-link roots, and document-level incoming ref suppression when any descendant links back.
- Audited the link matrix and added explicit source/target-side tests for:
  - child file links under non-first roots,
  - child graph links under non-first roots,
  - top-level file-link roots,
  - top-level graph-link roots,
  - mutual file links from both sides,
  - mutual graph links from both sides,
  - graph incoming refs accepted into bidirectional links and then viewed from the source side.
- Indexed links on top-level nodes themselves so top-level file-link and graph-link roots can produce incoming refs.
- Made top-level file-link incoming rows fall back to the outgoing document target when there is no source parent.
- Expanded document-link coverage checks to traverse descendants, not just immediate document roots.
- Made direct graph bidirectional rows show the source context when the target has no context labels, matching file-link bidirectional visibility.
- Verification passed:
  - `npm test -- src/editor/MultiTopNodeDocuments.test.tsx src/editor/FileLinks.test.tsx --runInBand`
  - `npm run lint`
  - `npm run typescript`
