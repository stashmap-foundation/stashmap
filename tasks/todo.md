# Document Containers And Multi-Root Documents

## Goal

A document is a storage/sync container. It can contain zero, one, or many top-level graph nodes. Root nodes remain graph nodes. Filesystem and Nostr sync identify documents by `docId` / `knowstr_doc_id`, not by filename, title, or root text.

## Current Status

Implemented in this branch:

- `Document` has `title`, frontmatter metadata, and `topNodeShortIds`.
- `/d/:author/:docId` document routes and `/r/:rootNodeId` node routes replace stack-based `/n/...` navigation.
- Document panes render all top-level roots in the document.
- Workspace scan/save supports multiple top-level roots without synthetic wrapper roots.
- Document markdown renders from graph nodes and preserves one frontmatter block per document.
- Document/file links navigate to document routes and appear as incoming refs at document level.
- File link row actions open the target document in fullscreen or split panes.
- Drag/drop preserves document-link behavior.
- Filesystem, watcher, and Nostr document paths pass parsed documents with materialized nodes into `DocumentStore`.

## Remaining UX Work

- Breadcrumbs should be document-container-first for document routes and document links.
- The document/container breadcrumb segment should navigate to the document overview.
- Relevance and argument markers should work on existing top-level document nodes.
- New document creation still needs a final container/title/filename policy pass.

## Remaining Markdown And Import Cleanup

- Avoid storing full long ids when writing markdown links if short ids are enough.
- Fix multi-file import for document containers.
- Decide whether `graphIndex.nodeByID` should remain or be reduced after the graph-as-source migration.
