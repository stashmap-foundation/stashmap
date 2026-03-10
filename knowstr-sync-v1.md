# Knowstr Sync V1

## Goal

Make external agents effective quickly by exporting the graph into a local markdown workspace.

The key split is:

- Knowstr/Nostr remains the canonical source of truth
- a local synced workspace is the read surface for agents
- writes still go back through a small structured CLI

This is the fastest path for Claude Code and Codex, because they already work well with files, folders, and `rg`.

## Why Sync First

A sync-first design is simpler than building a rich read CLI first.

Benefits:

- agents can read markdown directly
- agents can use normal file navigation and grep
- the first read path does not need `search`, `resolve`, or `subtree` commands
- the web app stays decoupled from agent execution

This also keeps the tool boundary clean:

- content is read as markdown
- write planning and results are returned as JSON

## V1 Scope

V1 provides one-way export only.

It supports:

- one-shot snapshot export via `sync pull`
- exporting a readable markdown workspace
- including stable identifiers in frontmatter and a manifest
- re-running `sync pull` whenever the local workspace is stale

It does not support:

- editing files and syncing them back automatically
- two-way reconciliation
- file-based deletes or moves
- continuous background sync in V1

## Command Surface

Command:

```text
knowstr sync pull --as-user <userPubKey> --out ./knowstr-sync
```

Suggested options:

- `--as-user <pubkey>`: compute the read universe from this user's perspective
- `--out <dir>`: output directory
- `--include-authors <pubkey,...>`: include specific extra authors regardless of follow state
- `--clean`: replace stale exported files before writing the new snapshot

V1 can keep the command small. A single `pull` command is enough.

## Pull Versus Watch

`sync pull` should mean:

- one-shot snapshot export
- deterministic materialization of current graph state
- safe to rerun whenever fresher context is needed

It should not mean:

- a long-running listener
- incremental in-place mutation of the workspace while an agent is reading

If Knowstr later wants a live local mirror, that should be a different command, for example:

```text
knowstr sync watch --as-user <userPubKey> --out ./knowstr-sync
```

That distinction keeps V1 simple and keeps agent reasoning predictable.

## Read Scope Model

The important distinction is:

- `follow` is a public social/contact action
- `read scope` is a local query/sync decision

For agent workflows, those should not be the same thing.

Quick-path rule:

- local companion agents should read one shared workspace synced from the user's perspective
- the user's follows define that workspace once
- agents do not need to publish their own mirrored follow lists

So the first useful behavior is:

```text
knowstr sync pull --as-user <userPubKey> --out ./knowstr-sync
```

All local agents can read from that same exported workspace.

Practical rule:

- agents should pull at the start of a task
- they do not need to pull after every write
- they should pull again only when they need fresh read context

Optional extension:

- `--include-authors <pubkey,...>` can add agent authors or other explicit sources even if they are not followed by the user

Important non-goal:

- do not make the gardener, ingest agent, or task agent publish contact-list events just to see what the user sees

## Output Shape

Suggested directory layout:

```text
knowstr-sync/
  HOME.md
  CONTACTS.md
  manifest.json
  authors/
    self/
      roots/
        pubkey_uuid-knowstr.md
        pubkey_uuid-inbox.md
    32ab...9f/
      roots/
        otherpubkey_uuid-to-review.md
```

Design notes:

- `HOME.md` is a convenience export of `~Home`
- `CONTACTS.md` is a convenience export of the current contact list / follow state
- author folders keep agent/user material separate
- filenames should be stable enough for repeated syncs, but the real identity comes from metadata, not from the filename

## File Format

Each exported markdown file should start with frontmatter.

Example:

```md
---
relationID: pubkey_uuid
cref: cref:pubkey_uuid
author: pubkey_hex
rootID: uuid
updated: 2026-03-09T12:34:56Z
path: Projects / Knowstr / Agent Ideas
url: /r/pubkey_uuid
basedOn: otherpubkey_olduuid
---

# Knowstr Agent Ideas {uuid}

- CLI Authoring {uuid}
- Gardener Workflow {uuid}
```

Important rule:

- the markdown body is for reading
- the frontmatter carries the stable selectors needed for later writes

## Manifest

The export should also include a machine-friendly manifest.

Example shape:

```json
{
  "generatedAt": "2026-03-09T12:34:56Z",
  "scope": {
    "asUser": "pubkey_hex",
    "includeAuthors": ["agent_pubkey_hex"]
  },
  "documents": [
    {
      "relationID": "pubkey_uuid",
      "cref": "cref:pubkey_uuid",
      "author": "pubkey_hex",
      "file": "authors/self/roots/pubkey_uuid-knowstr.md",
      "path": "Projects / Knowstr"
    }
  ]
}
```

The manifest is for tools, not for primary reading.

## Read Model For Agents

The first combined query-and-author agent should read by:

1. running `knowstr sync pull --as-user <userPubKey>`
2. inspecting `HOME.md`, `CONTACTS.md`, and relevant root files
3. using `rg` and normal file navigation to gather context
4. extracting exact cref or relation IDs from frontmatter when it needs to write

This is why a rich read CLI can be postponed.

## Write Boundary

The synced workspace is not the write API.

Agents may:

- read exported markdown
- create temporary local notes or plans
- use frontmatter identifiers to target later writes

Agents should not:

- edit synced markdown and expect Knowstr to import it automatically
- treat file paths as canonical identities

Final writes should always go through the write CLI.

## Staleness Model

The export is a materialized view, not a live mount.

So V1 should assume:

- the workspace may become stale
- the agent can rerun `knowstr sync pull` before a write if freshness matters
- write results should return enough created IDs that an immediate repull is often unnecessary
- write commands should still validate targets against the current graph state

## Suggested First User Stories

### Query Story

User:

- "What is going on in Knowstr agent work?"

Agent:

1. runs `knowstr sync pull --as-user <userPubKey> --out ./knowstr-sync`
2. opens `HOME.md`
3. uses `rg "agent|garden|sync" knowstr-sync`
4. reads the relevant markdown files
5. answers in natural language

### Author Story

User:

- "Create a project skeleton for Knowstr agents under Projects/Knowstr"

Agent:

1. runs `knowstr sync pull --as-user <userPubKey> --out ./knowstr-sync`
2. finds the target by reading exported files and frontmatter
3. writes the new subtree as markdown
4. calls the write CLI with the target cref
5. shows dry-run output
6. applies only on explicit confirmation
7. pulls again only if the next step needs the refreshed graph state

### Contacts Story

User:

- "Add the gardener agent under my Agents doc and follow it"

Agent:

1. runs `knowstr sync pull --as-user <userPubKey> --out ./knowstr-sync`
2. checks `CONTACTS.md` and the exported `Agents` document
3. inserts a markdown subtree containing `:robot: gardener {userPublicKey="..."}`
4. calls `knowstr follow --pubkey ... --json`
5. shows the dry-run plans
6. applies on confirmation

## Repo Implementation Strategy

The sync exporter should reuse existing document materialization code rather than inventing a second graph model.

Primary reuse targets:

- `markdownDocument.tsx` for subtree serialization
- existing data loaders/query logic for gathering current documents
- contact handling for `CONTACTS.md`

The exporter should stay read-only in V1.

## Summary

The first external-agent path should be:

- sync markdown for reading
- use normal file tools for context
- keep a small write CLI for mutations

Later, if freshness and concurrency become the bottleneck, add `sync watch` as a separate mode instead of overloading `sync pull`.

That gets Claude Code and Codex useful quickly without committing to a complex read API too early.
