# Document Containers And Multi-Root Documents

## Goal

Move from "one document must have one root" to:

```text
Document container / top-level graph node / child
```

A document is a storage/sync container. It can contain zero, one, or many top-level graph nodes. Root nodes remain graph nodes. Filesystem and Nostr sync identify documents by `docId` / `knowstr_doc_id`, not by filename, title, or root text.

## Decisions

- Breadcrumbs become container-first: `Document / Root / Child`.
- The first breadcrumb segment is not a graph node.
- Selecting the document/container segment should show all top-level roots in that document.
- Display name precedence: explicit `title`, filesystem basename without `.md`, then `Document <short docId>`.
- Filesystem-first plain markdown derives its initial display name from the filename.
- Nostr-first document creation stores a title as document metadata.
- First filesystem sync for a Nostr-first document slugifies the title into the initial filename.
- After a file exists, title changes must not silently rename the file.
- A document may have paragraph/list/heading roots; roots are not constrained by document naming.

## Iteration 1: Document Name Model

Add document naming without changing graph/root behavior yet.

- [ ] Extend the `Document` model with optional `title`.
- [ ] Add a document display-name helper:
  - [ ] explicit `title`
  - [ ] filename basename without `.md`
  - [ ] `Document <short docId>`
- [ ] Parse `title` from markdown frontmatter when present.
- [ ] Filesystem load derives fallback display name from `relativePath`.
- [ ] Add `title` metadata to Nostr document events.
- [ ] For now, derive the Nostr event `title` from the first top-level node when no explicit document title exists.
- [ ] Keep root parsing and save behavior unchanged in this iteration.

Tests:

- [ ] explicit title wins over filename
- [ ] filename fallback works
- [ ] doc id fallback works
- [ ] title does not affect node parsing
- [ ] Nostr document event gets a `title` derived from the first node when no explicit title exists

## Iteration 2: Breadcrumb Uses Document Container

Keep single-root documents for now, but change UI semantics.

- [ ] Find breadcrumb construction and document ownership lookup.
- [ ] Replace the visible root segment with document display name when document ownership is known.
- [ ] Keep the current root selection/open behavior internally.
- [ ] Make the document segment inert or route to the current root until document overview exists.

Tests:

- [ ] single-root file shows document-name-first breadcrumb
- [ ] matching document/root names do not render as duplicate adjacent labels
- [ ] no-file fallback shows `Document <short docId>`

## Iteration 3: Parse And Load Multi-Root Documents

Remove the read-side blocker.

- [ ] Change filesystem scan shape from `mainRoot` to `roots`.
- [ ] Replace `parseWorkspaceDocumentRoots` with a document-forest parser.
- [ ] Do not synthesize wrapper roots.
- [ ] Keep one `Document` per file/event.
- [ ] Lean on existing `parseDocumentContent`, which already materializes multiple top-level roots.

Tests:

- [ ] one markdown file with two headings materializes both as top-level roots
- [ ] a top-level paragraph root is accepted
- [ ] existing single-root files still load
- [ ] decide whether empty documents are accepted now or deferred

## Iteration 4: Render And Save Multi-Root Documents

Make write-back preserve document forests.

- [ ] Add graph-to-markdown rendering for a list of root nodes in one document.
- [ ] Update filesystem save to render all roots belonging to a document/file.
- [ ] Preserve one `docId` and one frontmatter block per document.
- [ ] Do not auto-rename a file when a second root appears.

Tests:

- [ ] two top-level roots save back into one file
- [ ] no synthetic wrapper root appears
- [ ] node ids are preserved
- [ ] adding a second root changes content only, not file path
- [ ] deleting one root from a multi-root document leaves the file if other roots remain

## Iteration 5: Document Overview Selection

Make the container segment real UX.

- [ ] Add a document overview view state: selected document container, no selected root.
- [ ] Overview renders all top-level roots as siblings.
- [ ] Clicking a root enters normal graph navigation.
- [ ] Breadcrumb first segment selects the overview.

Tests:

- [ ] selecting document segment shows all roots
- [ ] selecting a root shows graph path under the same document
- [ ] single-root documents still work naturally

## Iteration 6: New Document Creation And Filename Policy

Fix new-document naming for future multi-root documents.

- [ ] `New` creates a document container with a title.
- [ ] Initial filesystem path is `slug(title).md`.
- [ ] First graph content is separate from title.
- [ ] After file exists, title changes update metadata only.
- [ ] Defer explicit "rename file to match title" UI unless needed immediately.

Tests:

- [ ] document named `Projects` first syncs to `projects.md`
- [ ] adding a second root does not rename `projects.md`
- [ ] title rename updates metadata only, not file path

## Iteration 7: Filesystem/Nostr Sync Metadata

Make filesystem and Nostr round-trip the same document identity/name.

- [ ] Keep `docId` as the sync key.
- [ ] Publish title metadata on Nostr document events.
- [ ] On filesystem -> Nostr sync, preserve `docId` and `title`.
- [ ] On Nostr -> filesystem first sync, create filename from title.
- [ ] On later sync, match existing files by `docId`.

Tests:

- [ ] filesystem title publishes to Nostr
- [ ] Nostr title creates expected first filename
- [ ] filename rename does not create a duplicate Nostr document
- [ ] title rename does not create a duplicate filesystem file

## Suggested First PR

Do Iteration 1 only. It creates the document naming primitive and starts publishing Nostr `title` metadata without changing the single-root behavior yet.
