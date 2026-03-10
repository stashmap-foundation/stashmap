# Agentic Workflow V1 Implementation Plan

## Goal

Build the first practical agent workflow for Knowstr:

1. `sync pull` exports a local markdown workspace so an agent can answer questions
2. explicit `write` commands let the agent create and link graph content

This version is for an invoked local agent acting as the user, not for background agents with separate pubkeys.

## V1 Scope

- one local CLI: `knowstr`
- one shared synced workspace per read perspective
- one local agent directory per agent
- relay selection via repeated CLI flags and local profile config
- `sync pull` is snapshot-based
- writes use explicit relation IDs
- no watch mode
- no path guessing for writes
- no separate agent pubkey for the "me" agent

## Directory Model

Recommended layout:

```text
knowstr/
  shared/
    sync-me/
      manifest.json
      roots/
      users/
  agents/
    codex-me/
      .knowstr/
        profile.json
        me.nsec
      workspace -> ../../shared/sync-me
      scratch/
```

Rules:

- the synced workspace is shared and treated as generated read-only content
- each agent keeps its own local `.knowstr/` dir and scratch space
- agents never edit synced markdown directly
- agents write only through `knowstr write ...`

## Why Shared Sync Dir

For V1, multiple local agents reading "the graph as me" should share the same synced export.

Benefits:

- one snapshot to refresh
- less duplication
- consistent read surface across agents
- simpler freshness model

Use separate synced dirs only when:

- the read scope is different
- the `--as-user` perspective is different
- an agent needs an isolated frozen snapshot
- refresh cadence must be independent

## CLI Shape

Use one binary with two command groups:

- `knowstr sync pull`
- `knowstr write ...`

The read surface is the synced workspace. The CLI stays write-focused.

## Configuration Model

Each agent should be able to run from its own directory without needing to leave it.

Primary config discovery:

1. current directory `.knowstr/profile.json`
2. fallback to `KNOWSTR_HOME`

Recommended `profile.json`:

```json
{
  "pubkey": "hex-pubkey",
  "nsec_file": "./.knowstr/me.nsec",
  "workspace_dir": "./workspace",
  "bootstrap_relays": [
    "wss://relay.example.com/"
  ],
  "relays": [
    {
      "url": "wss://relay.example.com/",
      "read": true,
      "write": true
    }
  ]
}
```

Rules:

- `.knowstr/` must be gitignored
- `*.nsec` files must not live in the repo
- secret files should use `chmod 600`
- `sync pull` only needs pubkey + relay config
- `write` commands need signing material

## Relay Resolution

The CLI needs both profile-based relay defaults and per-command overrides.

Relays should be treated as a set, not a single scalar parameter.

Recommended command support:

- repeated `--relay <url>` flag for ad hoc override
- profile-based relay defaults in `.knowstr/profile.json`

Resolution order for `sync pull`:

1. explicit `--relay` flags on the command
2. `bootstrap_relays` and `relays[].read === true` from `profile.json`
3. the user's published relay metadata if it can be discovered
4. app `DEFAULT_RELAYS` as final bootstrap fallback

Resolution order for `write` commands:

1. explicit `--relay` flags on the command
2. `relays[].write === true` from `profile.json`
3. the user's published write relays if available
4. app `DEFAULT_RELAYS` as final fallback

Notes:

- `sync pull` should read from read relays, not blindly publish targets
- `write` commands should publish only to write relays
- relay URLs should be sanitized with the same helpers the app already uses
- commands should accept zero, one, or many `--relay` flags
- V1 does not need a separate relay config file beyond `.knowstr/profile.json`

## Agent Workflow

The "me" agent is not a separate Nostr identity.

It is a local tool process that:

1. runs `knowstr sync pull` when needed
2. reads the synced markdown workspace
3. runs `knowstr write ...` when asked to mutate the graph

Suggested freshness rule for agents:

- if workspace is missing: pull
- if the task is freshness-sensitive: pull
- if `pulled_at` is stale: pull
- otherwise use the local files

## Manifest Requirements

`sync pull` should write a manifest file with enough metadata for the agent to reason about freshness and IDs.

Minimum fields:

```json
{
  "workspace_version": 1,
  "as_user": "hex-pubkey",
  "pulled_at": "2026-03-10T14:30:00Z"
}
```

It should also include exported root metadata and stable identifiers for files/relations.

## Implementation Plan

### 1. CLI Foundation

- add `src/cli/` with a Node entrypoint and command router
- add package scripts to build CLI code separately from the React app
- parse repeated `--relay` flags into a relay array for sync and write commands
- make all command outputs machine-readable JSON

Initial files:

- `src/cli/index.ts`
- `src/cli/config.ts`
- `src/cli/types.ts`
- `src/cli/syncPull.ts`
- `src/cli/writeCreateRoot.ts`
- `src/cli/writeAddRef.ts`

### 2. Shared Pure Core

Extract or reuse CLI-safe logic into shared non-React modules.

Good candidates:

- document parse/serialize logic from `src/markdownDocument.tsx`
- event materialization logic from `src/knowledgeEvents.tsx`
- event kind and tag helpers from `src/nostr.ts`
- relay sanitizing and read/write filtering helpers from `src/relays.tsx`

Do not let the CLI depend on:

- React hooks
- pane/view state
- browser storage
- UI planner wiring

Recommended extraction targets:

- `src/core/graph/`
- `src/core/export/`
- `src/core/import/`
- `src/core/relay/`

### 3. Implement `knowstr sync pull`

Command:

```bash
knowstr sync pull --profile me --out ./workspace
knowstr sync pull --profile me \
  --relay wss://relay.example.com/ \
  --relay wss://relay.backup.example.com/
```

Responsibilities:

- fetch readable graph data from relays from the user's perspective
- resolve read relays from CLI flags or profile config
- reuse current document parsing logic to materialize relations
- export markdown files for roots
- export `manifest.json`
- preserve stable relation IDs and root metadata

### 4. Implement First Write Commands

First commands:

```bash
knowstr write create-root --title "Project X"
knowstr write create-root --title "Project X" \
  --relay wss://relay.example.com/ \
  --relay wss://relay.backup.example.com/
knowstr write add-ref --parent <relation-id> --target <relation-id>
knowstr write import-markdown --parent <relation-id> --file ./subtree.md
```

Rules:

- writes require explicit relation IDs
- paths may be used for discovery, not for direct writes
- publish relays can come from `--relay` or profile config
- commands return JSON including created/updated relation IDs and published event IDs

### 5. Document Agent Usage

Add or update docs so an external agent can follow the workflow end-to-end:

1. run `knowstr sync pull`
2. read/search the workspace with normal file tools
3. run explicit `knowstr write ...` commands

## Acceptance Criteria

- from an agent directory, Codex can run `knowstr sync pull` without leaving that directory
- the shared synced workspace is created successfully
- `sync pull` works with both profile relay config and explicit repeated `--relay` overrides
- the synced markdown is usable for question answering
- `write create-root` works and returns IDs
- `write add-ref` works and returns IDs
- no UI behavior must change to support V1

## Recommended First Slice

Implement only this first:

1. CLI scaffold
2. local profile discovery
3. `sync pull`
4. `write create-root`
5. `write add-ref`

That is enough to prove the first agentic workflow end-to-end.
