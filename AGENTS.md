# AGENTS.md

## Project coding rules

- Prefer simple, direct, functional code with plain data and explicit control flow.
- Do not introduce OOP unless an existing framework or external API requires it.
- Avoid classes, inheritance, mutable instance state, factories, registries, manager/service/controller objects, and needless polymorphic abstractions.
- Prefer small functions over objects with methods. Keep data as plain values and pass required inputs explicitly.
- Avoid duplicated or parallel logic: no repeated mapping/parsing/validation, copy-pasted branches, redundant wrappers, or reimplementation of existing utilities.
- Keep code minimal. Every new file, function, type, parameter, and branch must justify its existence. Prefer deletion, merging, or simplification over adding abstraction.
- Avoid optionality by default. Do not add optional function parameters, optional object fields, nullable/undefined unions, or partial internal data unless absence is a real domain state or required by an external API.
- Normalize data at boundaries so internal code receives complete required values.
- Do not add optional parameters for convenience, future-proofing, or to avoid updating call sites.
- Avoid spreading `undefined`/`null` through internal code; it causes defensive `??`, `?.`, guards, and fallback branches.
- Treat casts as a code smell. Do not introduce new casts/type assertions (`as`, angle-bracket assertions), non-null assertions (`!`), or `as any`/`as unknown as`; prefer narrowing, parsing/validation, discriminated unions, and correctly typed APIs.
- Reduce existing casts when touching code. If a cast is genuinely unavoidable because an external API type is wrong or incomplete, keep it localized and document why.
- Treat slop as a blocker: vague names, dead code, TODO/placeholders, broad try/catch, ignored errors, needless files, over-generalized abstractions, excessive comments compensating for poor structure, inconsistent style, and large mixed-responsibility functions.

## Testing rules

- Keep the repo green at all times. Break non-trivial work into small checkpoints before editing; a checkpoint should be one narrow behavior change or one subsystem migration, not a broad batch.
- Before each checkpoint, identify the expected tests/checks. After every checkpoint, run the full gate: `npm run typescript && npm run lint && npm test`.
- Don't run tests with `--runInBand`. The tests can and should always be able to be executed in parallel.
- Running the full test suite is cheap: `npm test` takes about 40 seconds without `--runInBand`. Use the full suite as the normal checkpoint gate.
- Focused tests may be run while debugging, but they do not replace the full-suite checkpoint gate.
- Do not continue to the next checkpoint while `typescript`, `lint`, or tests are red. Fix the central regression or revert the checkpoint first.
- If `npm test` fails broadly after a checkpoint, stop and fix the central regression or revert that checkpoint. Do not patch individual failing tests around a broken shared invariant.
- Never report a checkpoint or phase as complete with failing checks unless the user explicitly instructs you to do so.
- Prefer integration, e2e, system, CLI/UI flow, or public API tests over unit tests.
- Do not introduce new unit tests unless an integration-level test is genuinely impractical or cannot cover the behavior safely.
- Before writing tests, inspect existing tests and follow the closest existing project pattern.
- Do not invent a new test style, harness, fixture pattern, or assertion pattern when an existing pattern can be reused.
- If a unit test is truly necessary, document why integration-level coverage is not practical.

## Review rules

- Passing tests are necessary but not sufficient.
- Reject or fix unnecessary OOP, meaningful redundancy, avoidable optionality, new casts, unnecessary unit tests, invented test patterns, needless abstraction, and sloppy/over-large code.
- Ask what can be deleted while preserving behavior.
- Prefer direct fixes and simplification over layering more code on top.
