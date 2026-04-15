# MVP plan: `knowstr apply` for additive multi-user inbox

## Scope

- additions only
- preserve incoming short ids
- no rename suggestions yet
- no delete suggestions yet
- no text-edit suggestions yet
- parse each inbox file independently
- local graph ids must stay unique
- duplicate ids across inbox files are allowed

## Assumptions

- `maybe_relevant/` and `knowstr_log.md` are part of the normal graph
- top-level `inbox/` is staging only and must be ignored by `knowstr save`
- after successful `knowstr apply`, `inbox/` is empty

## Tests

- [x] `knowstr save` ignores the top-level `inbox/` folder
- [x] `knowstr apply --dry-run` reports a new child under a known parent as an in-graph `(?)` addition
- [x] `knowstr apply` writes a new child under a known parent into the existing local document with preserved incoming id and `maybe_relevant` relevance
- [x] `knowstr apply` puts a fully unknown subtree into `maybe_relevant/`
- [ ] `knowstr apply` trims mixed inbox content so known nodes are only kept as context around new descendants in `maybe_relevant/`
- [x] `knowstr apply` skips incoming nodes whose ids already exist locally in MVP
- [ ] `knowstr apply` dedupes two inbox files that contain the same new node id with the same parent/text
- [ ] `knowstr apply` does not auto-apply conflicting duplicates from inbox files with the same id but different parent/text; it writes a log entry and keeps them out of the local graph
- [x] `knowstr apply` writes `knowstr_log.md` entries for graph-applied additions and `maybe_relevant/` documents
- [x] `knowstr apply` clears `inbox/` only after successful writes

## Implementation

- [x] use the top-level reserved layout in the workspace
  - [x] `inbox/`
  - [x] `maybe_relevant/`
  - [x] `knowstr_log.md`
- [x] teach `knowstr save` to ignore the top-level reserved `inbox/` folder
- [x] add CLI command skeleton for `knowstr apply` with `--dry-run`
- [x] load the local workspace through the existing markdown -> graph pipeline
- [x] build a local index by short id and parent relationships
- [x] parse inbox files one-by-one through the same markdown -> graph pipeline
- [x] for each inbox file, classify incoming nodes:
  - [x] known id locally -> skip in MVP
  - [x] new id, known parent locally -> candidate in-graph `(?)` insertion
  - [x] otherwise -> candidate `maybe_relevant/` subtree
- [ ] add dedupe/conflict handling across candidate additions from multiple inbox files
- [x] serialize touched local roots back to markdown using the existing graph -> markdown pipeline
- [x] serialize fallback trees into `maybe_relevant/`
- [x] append/update `knowstr_log.md`
- [x] on success, empty `inbox/`
- [x] on `--dry-run`, report planned actions without writing

## Open questions

- [ ] exact naming scheme for generated files in `maybe_relevant/`
- [ ] exact wording/shape of `knowstr_log.md` entries
- [ ] what to do with conflicting duplicate inbox entries in MVP beyond logging
- [ ] whether mixed files should preserve new wrapper context even when leaf additions were injected directly into the graph

## Review

- [x] run targeted jest tests for `save` and new `apply` behavior
- [x] run `npm run typescript`
- [x] run `npm run lint`

Implemented first slice:

- top-level `inbox/` is now ignored by `knowstr save`
- new `knowstr apply` CLI command exists with `--dry-run`
- additive MVP works for:
  - known-parent additions injected into existing docs as `(?)`
  - fully unknown subtrees written to `maybe_relevant/`
  - `knowstr_log.md` updates
  - inbox clearing after successful apply

Still missing in code:

- explicit tests and stronger handling for duplicate/conflicting inbox ids
- mixed-file context preservation when part of the subtree was directly injected into the graph
