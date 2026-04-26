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

