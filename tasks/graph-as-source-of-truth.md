# Materialized Graph As Source Of Truth

## Goal

Make `MarkdownTreeNode` a parser intermediate. After parsing, downstream load, save, apply, indexing, and navigation code should use materialized `GraphNode`s plus `Document` metadata.

## Current Status

Implemented in this branch:

- `parseToDocument` returns `{ document, nodes }` and materializes markdown once for the caller.
- `Document` no longer stores raw `content`; it stores metadata and `topNodeShortIds`.
- Workspace scan returns scanned documents, materialized nodes, and aggregate `knowledgeDBs`.
- Filesystem load parses workspace files into `ParsedDocument`s before passing them to `DocumentStore`.
- `DocumentStore` accepts `ParsedDocument` and updates graph/index state without reparsing document content.
- Filesystem watcher parses changed file content once and upserts the parsed document.
- Nostr document handling uses `eventToParsed`; `parseDocumentEvent` and `parseDocumentContent` were removed.
- Inbox apply walks materialized `GraphNode`s instead of `MarkdownTreeNode`s.
- Inbox apply rejects within-file duplicate node ids and accepts files with missing ids by minting ids during materialization.
- Save renders from graph nodes via `renderDocumentMarkdown` / `renderRootedMarkdown`.
- `mainRoot` and the single-root workspace scan shape were removed.

## Remaining Follow-Ups

- Add a lightweight benchmark or regression test proving workspace load does not parse each file twice.
- Consider whether `parseToDocument`, `parseMarkdown`, and `materializeTree` names now express the intended entry points clearly.
- Decide whether `graphIndex.nodeByID` should remain the canonical lookup index or be reduced once callers no longer need it.
