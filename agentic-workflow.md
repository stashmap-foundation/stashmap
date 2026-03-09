# Agentic Workflow Roadmap

## Goal

Get to an agentic workflow in Knowstr with as few new concepts as possible.

The core split is:

- Background agents propose from their own pubkeys
- An invoked CLI agent authors directly as the user

The user's graph remains authoritative. Agent output is either:

- accepted into the user's graph
- ignored
- left as an external proposal

## Design Principles

- Reuse existing Knowstr primitives: multi-author merge, `suggestions`, `versions`, refs, split panes, deep copy
- Add conventions before adding schema
- Keep background agents out of the user's write authority
- Make the home page an index, not a content tree
- Keep `~Log` as a stream/history, not the curated landing page

## Minimal New Concepts

This roadmap tries to introduce only:

- one new reserved root: `~Home`
- one new reserved root: `~Users`
- one special rule: `~Home` is link-only
- one convention: one pubkey per background agent

Everything else should reuse existing behavior.

## Proposed Information Architecture

`~Log` remains the append-only stream of standalone roots.

`~Home` becomes the curated landing page.

Example:

```text
~Home
  Projects
    [link] Project A
    [link] Project B
  Areas
    [link] Coding
    [link] Health
  [link] Inbox
  [link] Tasks
  [link] Agent Proposals
  [link] ~Log
```

And separately:

```text
~Users
  Alice
  Bob
  :robot: gardener
  :robot: ingest
```

Important constraint:

- `~Home` should mainly contain refs, search links, and a few structural section labels
- `~Home` should not become a large content-bearing document
- In practice, `Projects` and `Areas` are small organizing labels; the interesting material lives in linked documents

## `~Home` Rules

To prevent `~Home` from turning into one giant root document:

- Typing a new item under `~Home` creates a standalone root document and inserts a ref to it into `~Home`
- Dragging something into `~Home` defaults to creating a ref, not deep-copying content
- Pasting a subtree into `~Home` creates standalone roots and links them from `~Home`
- Small section labels like `Projects` and `Areas` are allowed, but substantive content should live in linked documents
- The home button and `H` navigate to `~Home` if it exists, otherwise fall back to `~Log`

This keeps `~Home` curated and small, while content lives in normal documents.

## `~Users` Address Book

Knowstr also needs a simple user directory, especially once multiple agents are present.

The minimal model is:

- one root list: `~Users`
- each entry represents one user/contact
- the stable identity is the user's `publicKey`
- the visible text is just the editable label, for example `gardener` or `:robot: gardener`

Important non-goals:

- no separate `Agents` list
- no new role/type schema
- no extra contact object model inside the graph

This should behave like an ordinary list in the UI:

- sortable
- renameable
- navigable like other lists

But under the hood it should still key entries by `publicKey`, not by the visible label.

That gives Knowstr a simple address book without inventing a parallel user-management system.

## Agent Roles

### Background Agents

Background agents use separate pubkeys and write to their own graphs.

Initial set:

- `agent/ingest`: captures emails, clips, transcripts, quick capture into agent-owned intake trees
- `agent/gardener`: proposes local structure, links, and cleanup by maintaining short-lived detached forks
- `agent/tasks`: extracts actionable items into an agent-owned task tree with refs back to source notes

Optional later:

- `agent/research`: builds agent-owned research trees and links them into the user graph
- `agent/drafts`: rewrites selected material into cleaner alternative versions

### Invoked CLI Agent

The CLI agent is different. It is a user-directed authoring interface.

When the user says "create this graph structure", the CLI agent should usually:

- write as the user
- create real standalone documents
- wire those documents into `~Home` or another explicit target

It should not behave like a background proposer unless the user explicitly asks for a proposal.

This agent is not assumed to be embedded in the web app. It can be a CLI tool or companion app that talks to the user's graph directly.

## CLI Agent Query Model

Because the CLI agent writes as the user, it should be able to query the graph. Otherwise it is a blind writer.

The important correction is that this query model should not depend on the web app passing UI state like the currently focused node.

Instead, the external CLI agent should work from graph queries plus explicit user intent.

Recommended capabilities:

- search the user's graph for matching roots, documents, and paths
- resolve an explicit target named by the user, such as `Projects / Knowstr`
- inspect a target subtree before writing into it
- read `~Home` to find canonical entry points
- check whether a requested structure already exists before creating new documents

Recommended inputs from the user:

- a target path, if known
- a root name, if known
- a document URL or relation ID, if available
- otherwise a plain-language request and permission to choose placement

Default behavior:

- if the user names a target, query and write there
- if the user gives a URL or relation ID, resolve that target and write there
- if the request clearly belongs under an existing root, query and reuse that root
- otherwise create standalone roots and link them from `~Home`

This keeps the CLI agent external to the web app while still making it context-aware.

## How Restructuring Works

When the gardener wants to reorganize content significantly:

- It publishes the new destination structure in its own graph
- The user sees additions as `suggestions`
- The user sees alternative source structures as `versions`
- The gardener maintains a `To Review` document that links to the documents it changed
- The user opens the gardener's author view in another pane and copies over the accepted structure
- The user deletes or archives the old placements in their own graph

This is not an atomic patch system. It is a proposal-and-adopt workflow built from existing primitives.

## Fork Semantics

Forks should be detached workspaces, not live-tracking branches.

That means:

- a fork copies the source state once
- the fork stores the source state as its base snapshot
- the fork's proposal is computed from `fork current` versus `fork base`
- the fork is not continuously diffed against the source author's latest state

This avoids drift.

Without this rule, an untouched or lightly edited fork keeps appearing more and more different as the upstream author continues editing, even when the fork author did nothing new.

The intended semantics are:

- `fork` = detached editable copy
- `proposal delta` = intentional changes since fork
- `source changed` = separate status, not proposal inflation

This is especially important for the gardener model, because the original author should see the gardener's intentional changes, not a growing diff caused by unrelated upstream activity.

## Gardener Proposal Model

The gardener should start with a deliberately constrained workflow.

Core rule:

- the gardener may manipulate multiple documents
- the gardener must never create links to documents inside its own workspace
- every meaningful gardener-created link should point to a stable external target, such as canonical user content or ingest-owned content

Normal loop:

1. gardener forks the user's current version of the documents it wants to improve
2. gardener edits those forked documents into the desired shape
3. gardener adds or updates a `To Review` document with links to the edited documents
4. the user reviews those edited documents and takes over the useful changes into the canonical graph
5. the user dismisses the stale gardener versions
6. gardener deletes or refreshes its workspace only when it wants a new base snapshot

This makes gardener proposals short-lived. The gardener is a suggestion layer, not a durable parallel author of the user's graph.

What the gardener may do safely:

- add children to forked documents
- rename and reorder rows inside forked documents
- edit multiple related documents during one gardening pass
- add refs from forked documents to stable external targets such as ingest-owned notes
- add refs from forked documents to canonical user documents
- maintain a `To Review` document that links to the edited documents

What the gardener should not do in V1:

- create links from one forked gardener document to another forked gardener document
- rely on live-source diffing to communicate proposal intent

The practical consequence is:

- the gardener workspace is for edited copies
- the `To Review` document is for navigation and review
- the gardener should never build a self-contained internal graph of proposal-to-proposal links
- the gardener's useful output is the delta from its fork base, not the difference to today's upstream state

## Why Proposal-Internal Links Are Hard

Multi-document gardening itself is acceptable if proposal links always point outward.

The hard case appears when the gardener forks two related documents, for example `A -> A1` and `B -> B1`, and then creates links between the forked copies.

That creates a hard adoption problem:

- refs from `A1` to stable external content are usually fine
- refs from `A1` to `B1` are proposal-local
- on adoption, those proposal-local refs would need to be remapped back to the user's canonical identities

This is feasible only with a stronger identity model than the app has today.

## Future Requirement For Multi-Document Adoption

If Knowstr later wants true multi-document gardening, it likely needs:

- a stronger alias/lineage model than plain `basedOn`
- an adoption/reconcile flow that maps proposal rows back to canonical user rows
- explicit conflict handling for ambiguous restructures

The simple one-to-one cases are:

- rename
- move

The ambiguous cases are:

- split: one canonical row becomes two proposal rows
- merge: two canonical rows become one proposal row
- duplicate: one canonical row is intentionally reused in multiple places

Those cases are why a better alias model is the main prerequisite for safe multi-document gardening.

## Phased Plan

### Phase 1: Separate Home From Log

Objective:

- stop using `~Log` as both stream and dashboard

Steps:

1. Introduce reserved node `~Home`
2. Change home navigation to prefer `~Home`, fallback to `~Log`
3. Keep `~Log` linked from `~Home`
4. Make `~Home` link-only
5. Seed a minimal default structure under `~Home`

Success criteria:

- the user has a stable landing page
- new root documents no longer clutter the curated home structure
- `~Log` still works as history

### Phase 1.5: Add `~Users`

Objective:

- give the user a graph-native address book for people and agents

Steps:

1. Introduce reserved node `~Users`
2. Surface followed users there as ordinary list entries
3. Keep `publicKey` as the stable identity for each entry
4. Allow the visible label to be edited independently
5. Reuse ordinary list affordances like sorting and navigation

Success criteria:

- users can rename contacts and agents to human-friendly labels
- multiple agents are manageable without remembering raw npubs
- the feature adds no separate agent/user taxonomy

### Phase 2: Add CLI Authoring

Objective:

- let the user create graph structures from natural-language instructions

Steps:

1. Define a CLI command or prompt flow that takes a structure request
2. Make the CLI agent write as the user
3. Add graph query capability so the CLI agent can inspect the user's existing structure before writing
4. Default target selection:
   - explicit target path if provided
   - URL or relation ID if provided
   - otherwise reuse an existing matching root if one exists
   - otherwise create standalone roots and link them from `~Home`
5. Start with create-and-link workflows only
6. Avoid background monitoring or autonomous edits in this phase

Success criteria:

- a user can describe a project structure in the CLI
- the resulting documents are created in the user's graph
- `~Home` gets links, not embedded content trees
- the CLI agent can reuse existing graph structure without depending on web-app integration

### Phase 3: Add Background Agent Conventions

Objective:

- establish safe agent behavior without new schema

Steps:

1. One pubkey per background agent
2. Stable root names per agent, such as `Inbox`, `Tasks`, `Research`, `To Review`
3. Background agents write only to their own graphs
4. Follow the agent accounts from the user account
5. Rely on merged multi-author views to surface output

Success criteria:

- agent output appears naturally inside existing Knowstr views
- no background agent needs direct write access to the user's graph

### Phase 4: Make Proposal Workflows Legible

Objective:

- make large restructures understandable and adoptable

Steps:

1. Make detached fork semantics explicit
2. Compute proposal deltas from fork base snapshots, not from live upstream state
3. Use `To Review` documents to point at edited forks
4. Encourage side-by-side review in split panes
5. Use existing suggestion/version overlays as the primary acceptance path
6. Show upstream changes as a separate status instead of inflating proposal diffs

Success criteria:

- large reorganizations are visible as coherent alternatives
- the user can adopt them without losing authorship of the final graph
- untouched or lightly edited forks do not accumulate diff noise as upstream evolves

### Phase 5: Roll Out Agents Incrementally

Objective:

- avoid inventing a five-agent system before the first one is useful

Recommended order:

1. `~Home`
2. `~Users`
3. CLI authoring agent
4. `agent/ingest`
5. `agent/gardener`
6. `agent/tasks`
7. optional research/drafts agents

Reasoning:

- `~Home` provides the landing point
- `~Users` makes people and agents manageable
- CLI authoring solves immediate graph creation
- ingest and gardener create the first real proposal loop
- tasks is useful once there is enough source material to extract from

## Safety Rules

- Background agents never publish as the user
- Background agents should attach provenance wherever possible
- The CLI agent writes as the user only in explicit invoked sessions
- Large restructures should be proposals first, not silent edits

## Non-Goals For V1

- Atomic multi-document apply/merge
- Fully autonomous background editing of the user's graph
- A complex orchestration layer between agents
- New graph schema for tasks, inboxes, or proposals

## Summary

The simplest path is:

1. Create `~Home` as a link-only dashboard
2. Keep `~Log` as the automatic stream
3. Add a CLI authoring agent that writes as the user
4. Add background agents that propose from their own pubkeys
5. Let the user adopt proposals with existing Knowstr primitives

That gets Knowstr to an agentic workflow without turning it into a separate orchestration system.
