# Knowstr Write CLI V1

## Goal

Define the first mutation interface for external agents after the graph has been synced to a local markdown workspace.

The intended workflow is:

- read the graph from the synced markdown workspace
- write new content as markdown
- execute mutations through a thin `knowstr` CLI

This file is intentionally write-focused. Read/query commands can come later if the sync-first path proves insufficient.

## Why Keep The CLI Small

The main read surface should be the synced workspace, not the CLI.

Benefits:

- agents read markdown instead of JSON blobs
- the write interface stays narrow and safer
- path discovery can happen in files, while writes still use stable IDs
- the web app remains decoupled from agents

## V1 Scope

V1 supports:

- creating new root documents from markdown
- inserting markdown subtrees under an existing target
- creating refs
- linking items into `~Home`
- following and unfollowing pubkeys

V1 does not support:

- delete
- move
- write-back from edited synced files
- bulk rewrite of existing documents
- generic row-level editing
- gardener workflows
- proposal adoption
- live-tracking forks

## User Model

The first agent is still one combined external agent with two modes:

- `query`: reads the synced workspace
- `author`: writes as the user only on explicit request

## CLI Design Principles

- markdown for document content
- JSON for dry-run plans, warnings, and results
- write commands default to dry-run
- actual publication requires explicit `--apply`
- selectors should prefer stable targets such as `relationID` and cref
- the synced workspace is for discovery; the CLI is for mutations
- the CLI should talk in graph/document terms, not UI gestures or editor deltas

## Command Surface

Command namespace:

```text
knowstr <command> [subcommand] [options]
```

### Write Commands

All write commands should:

- default to dry-run
- emit JSON describing intended writes
- only publish when `--apply` is present

#### `knowstr create-root`

Create a new standalone root document from markdown.

Example:

```bash
knowstr create-root --title "Knowstr Agents" --file outline.md --json
knowstr create-root --title "Knowstr Agents" --file outline.md --apply --json
```

#### `knowstr insert-subtree`

Insert a markdown subtree under an explicit target.

Example:

```bash
knowstr insert-subtree --under-cref "cref:pubkey_uuid" --file outline.md --json
```

V1 expectation:

- preferred target input is a cref or relation ID
- the agent should normally get that target from synced frontmatter or the manifest
- if a convenience path form is added later, it must resolve to one unique target first

#### Editing Model

V1 deliberately avoids general in-place editing of existing documents.

The safe editing surface is:

- create new roots from markdown
- insert new markdown subtrees under explicit targets
- create refs
- update `~Home`
- update follow state through `contacts`

This means the agent does not rewrite existing persisted markdown documents wholesale.

Ordinary user entries should be created as ordinary markdown rows. If the visible label
should not be the raw `npub`, the row can carry an explicit `userPublicKey` attr.

Example:

```md
- :robot: gardener {userPublicKey="hex_pubkey"}
  - role
    - gardener
```

#### `knowstr create-ref`

Create a reference from one document position to another stable target.

Examples:

```bash
knowstr create-ref --from-cref "cref:pubkey_uuid" --to-cref "cref:other_uuid" --json
knowstr create-ref --from-relation "pubkey_uuid" --to-relation "otherpubkey_uuid" --json
```

#### `knowstr add-home-link`

Add a link into `~Home`.

Examples:

```bash
knowstr add-home-link --to-cref "cref:pubkey_uuid" --section Projects --json
knowstr add-home-link --to-relation "pubkey_uuid" --section Areas --apply --json
```

This command should enforce the `~Home` rule:

- add links, not embedded content

#### `knowstr follow`

Add a pubkey to the contact list.

Examples:

```bash
knowstr follow --pubkey pubkey_hex --json
knowstr follow --pubkey pubkey_hex --apply --json
```

#### `knowstr unfollow`

Remove a pubkey from the contact list.

Examples:

```bash
knowstr unfollow --pubkey pubkey_hex --json
knowstr unfollow --pubkey pubkey_hex --apply --json
```

## Dry-Run Output

All write commands should return a plan-like summary.

Example:

```json
{
  "mode": "dry-run",
  "command": "insert-subtree",
  "writes": [
    {
      "kind": "document",
      "action": "create",
      "path": "Projects / Knowstr / Agent Ideas"
    },
    {
      "kind": "home-link",
      "action": "add",
      "path": "~Home / Projects / Knowstr"
    }
  ],
  "warnings": []
}
```

On `--apply`, the command should return the same summary plus publication results and created relation IDs.

## Target Selectors

Selectors should support:

- `--relation`
- `--cref`

Write commands should also accept:

- `--under-relation`
- `--under-cref`
- `--from-relation`
- `--from-cref`
- `--to-relation`
- `--to-cref`

Rules:

- write commands should prefer `relationID` or cref
- the synced workspace should provide those selectors in frontmatter and manifest data
- if convenience selectors like path or URL are ever accepted for writes, they must resolve to exactly one target first
- the CLI should always resolve final write targets to concrete relation IDs before planning writes

## Safety Model

V1 safety rules:

- read-only unless the command is a write command
- write commands are dry-run by default
- `--apply` is required for publication
- no destructive commands in V1
- no implicit writes while answering read-only questions from the synced workspace

Suggested agent behavior:

1. sync first
2. inspect markdown files and identify concrete targets
3. show dry-run
4. apply only if explicitly instructed

## Signing

V1 can start with the simplest viable signer setup:

- local test key in config/env

Later improvements:

- extension-backed signing
- bunker/remote signer
- explicit profile selection

Signing should be separated from command planning so dry-run remains cheap and safe.

## Repo Implementation Strategy

The CLI should reuse existing code rather than reimplementing the graph.

Primary reuse targets:

- `planner.tsx` for write planning
- `executor.tsx` for publishing
- `markdownDocument.tsx` for document serialization/materialization
- contact handling for follow / unfollow

The CLI itself should be a thin adapter around those modules.

## Suggested Build Order

### Step 1: Dry-run write planning

Implement:

- `create-root`
- `insert-subtree`
- `create-ref`
- `add-home-link`
- `follow`
- `unfollow`

All return dry-run JSON only.

### Step 2: Apply path

Add:

- `--apply`
- signer integration
- publication result reporting

This makes the first write-for-me agent viable.

### Step 3: Agent prompt rules

Write short operating prompts for Claude Code/Codex:

- sync first
- prefer concrete targets from frontmatter
- never dump content into `~Home`
- keep people and agents in ordinary address-book docs, not a reserved root
- use dry-run before apply

## First End-To-End User Stories

### Query Story

User:

- "What is going on in Knowstr agent work?"

Agent:

1. runs `knowstr sync pull`
2. reads synced markdown files
3. summarizes the result

### Author Story

User:

- "Create a project skeleton for Knowstr agents under Projects/Knowstr"

Agent:

1. runs `knowstr sync pull`
2. finds the target cref in synced metadata
3. writes an outline file or inline markdown
4. runs `insert-subtree --under-cref ... --json`
5. shows dry-run result
6. runs the same command with `--apply` if explicitly asked

### Contacts Story

User:

- "Add the gardener agent under my Agents doc and follow it"

Agent:

1. runs `knowstr sync pull`
2. checks `CONTACTS.md` and the exported `Agents` document
3. inserts a markdown subtree containing `:robot: gardener {userPublicKey="..."}`
4. runs `follow --pubkey ... --json`
5. shows the dry-run plans
6. applies on confirmation

## Non-Goals For V1

- read/search CLI
- write-back from edited synced files
- gardener proposal execution
- proposal adoption UI
- delete/move operations
- multi-document merge/reconcile
- live-tracking fork behavior
- web-app embedded agent execution

## Summary

The first agent should not need a rich read API.

It should be:

- Claude Code or Codex
- reading a synced markdown workspace
- calling a small write CLI
- using markdown for content and JSON for plans/results

That is the fastest path to a useful agent while keeping the graph model under control.
