# Semantic Markers

Status: draft for review

This document proposes a compact marker grammar for knowstr-compatible semantic
graphs. The goal is to keep relationship semantics small while making draft
agent suggestions visible in Markdown.

## Node Types

Visible graph nodes should use a small set of types:

- `topic`
- `statement`
- `source`
- `person`
- `task`

`author` is not a separate node type. An author is a role of a `person`, and
authorship is represented from a `source` through metadata or a relation to that
person.

## Relation Types

Visible relation types should stay limited to:

- `contains`
- `relevant-for`
- `supports`
- `contradicts`
- `same-as`

`refines` is intentionally not a separate relation. Refinement, contextual
closeness, overlap, and "important for this question" are covered by
`relevant-for`.

`maybe-relevant` is also not a relation. Maybe/draft is a review status.

## Marker Grammar

The base symbol describes the relation or evaluation. A trailing `?` marks the
relation as draft/proposed.

| Marker | Meaning |
|---|---|
| no marker | accepted `contains` |
| `(?)` | draft `contains` |
| `(!)` | accepted `relevant-for` |
| `(!?)` | draft `relevant-for` |
| `(~)` | accepted weak `relevant-for` |
| `(~?)` | draft weak `relevant-for` |
| `(+)` | accepted `supports` |
| `(+?)` | draft `supports` |
| `(-)` | accepted `contradicts` |
| `(-?)` | draft `contradicts` |
| `(=)` | accepted `same-as` |
| `(=?)` | draft `same-as` |
| `(x)` | rejected |
| `(x?)` | rejection proposed |

The rule is: base symbol = semantic relation/evaluation; trailing `?` = draft
status.

## Same-As

`same-as` is strict. It means two nodes should be treated as the same entity or
merged. It is appropriate for real duplicates, spelling variants, language
variants, or confirmed synonyms.

Similar, overlapping, or contextually related topics should use `relevant-for`,
not `same-as`.

Examples:

```markdown
- (=?) Volkswirtschaftslehre
- (!?) Bitcoin
- (+?) This passage supports the statement.
- (-?) This passage contradicts the statement.
```

## Typed Contains Orders

`contains` is the default structural edge. It can be interpreted by node type,
so the same stable node can appear in multiple curated orders without being
duplicated.

- `topic contains topic`: logical outline
- `topic contains statement`: thematic placement
- `statement contains statement`: nested argument or excerpt structure
- `source contains statement`: provenance; the statement comes from the source
- `person contains source`: works by a person, usually chronological
- `person contains task`: operational work related to a person

This lets a statement-first view stay focused on the logical topic tree:

```markdown
# Praxeology

- (!) Human action is purposeful behavior. <!-- ref:statement-action-purposeful -->
```

The source view can contain the same statement ID:

```markdown
# Human Action

- Human action is purposeful behavior. <!-- ref:statement-action-purposeful -->
```

The UI can then answer "which source and person does this statement come from?"
with a reverse `contains` index:

1. Find `source` parents that contain the statement ID.
2. Find `person` parents that contain those source IDs.
3. Show source/person in a side panel or lazy expansion without forcing every
   topic view to inline provenance details.

