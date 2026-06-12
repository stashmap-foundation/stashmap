# Knowstr collaboration

Knowstr is a markdown-first, node-based graph editor. Users think in small text blocks — nodes — and arrange them into documents, which are nothing more than containers: nodes carry durable IDs, move freely between documents, and keep the underlying files readable, editable markdown. Rows are ranked with relevance markers; node-level `basedOn` and content-addressed `snapshot` metadata already round-trip through markdown.

The collaboration feature built on top of this is **a node-identity diff engine**: Knowstr can tell you — across any pile of files, folders, or copies — what is related to your nodes, what changed, and who changed it. Everything people do with it — sharing, comparing, taking — is plain file operations plus two commands.

It is not shared mutable editing. Nobody can overwrite anyone else's documents; people converge by seeing each other's changes as suggestions and taking what they want.

## The model

> Your workspace is yours: Knowstr writes only there, and node IDs inside it are unique.
>
> Copies made by any means keep their IDs, so relatedness is observable wherever copies end up; materializing a suggestion settles the relation into an explicit `basedOn` edge.
>
> `knowstr diff <address>` correlates your workspace against anything you point it at and reports, with attribution, how related nodes have drifted apart.

There is no setup. No registration, no configuration, no identity, no required state. The only persistent artifacts are the markdown files themselves and an invisible snapshot cache.

## Two vocabularies, and no third

Collaboration introduces no new syntax. It reuses the two vocabularies the editor already has:

1. **Node attributes**, in HTML comments: `id` (durable identity), `basedOn` (lineage), `snapshot` (baseline reference). All relational state is node-level — never document-level, because documents are just containers and nodes outlive their containers.
2. **Relevance markers**, as row prefixes: `(!)` relevant, `(?)` maybe relevant, `(~)` little relevant, `(x)` not relevant, `(+)`/`(-)` confirming/contra argument. This is how users rank rows — their own, and, it turns out, everyone else's.

A suggestion is therefore nothing special: **an ordinary row that arrives in your document at `(?)` carrying `basedOn`** — "maybe relevant, with lineage." The whole collaboration feature reduces to producing such rows and letting normal editing take it from there.

## Core mechanics

### Relations are born by copying and settled by materializing

Two nodes are related in exactly two ways:

- **Same ID** — a *born* relation. Node IDs are unique; the same ID appearing in two places cannot be coincidence, it means a copy happened. `cp`, email attachments, drag-and-drop — every copying tool in existence creates this relation for free.
- **`basedOn`** — a *settled* relation: a fresh node that records which node it derives from. Settled relations are directional, survive any rewording, and keep each side's graph internally unambiguous.

Born relations age badly under divergence (no direction, no per-pair baseline); settled relations are built for it. Knowstr converts born into settled only at the moments when it actually knows the direction — never at copy time, where nothing can be known:

- **materializing a suggestion** (see the lifecycle below) mints a fresh ID with `basedOn`;
- **saving a fetched document** whose in-file `track:` address declares its upstream (see `show`) re-mints the whole document with `basedOn` per node;
- **explicit `fork`** (staged layer).

Text equality is never used to establish identity, lineage, or suppression. Coincident wording means nothing.

### Baselines: invisible, lazy, self-healing

To say *who* changed something, a diff needs the common ancestor. The first time Knowstr observes a relation, it stores the other side's content as a snapshot — content-addressed (`snap_sha256_<hash of content>`), immutable, kept in one global store per machine at `~/.knowstr/snapshots/`, shared by the CLI and the app so both always see the same baselines (snapshot events on relays later). Nodes reference their baseline through the `snapshot="…"` attribute they already carry.

Properties that follow: identical content stores once regardless of how many workspaces hold it; losing the store is harmless because the next observation re-baselines (suggestions degrade for one window, then recover; nothing corrupts); no index exists beyond the markdown itself.

The honest limit of laziness: changes the other side made *before* first observation become part of the baseline instead of suggestions. Eventually consistent about history, always correct about structure.

### One hard rule inside the workspace

Duplicate node IDs across workspace documents are rejected by `save`, with guidance:

```text
error: holidays.md and drafts/holidays-v2.md both contain id:1
  - if drafts/holidays-v2.md is a variant, give it fresh IDs (future: knowstr fork)
  - if it's a backup, move it out or add it to .knowstrignore
```

Duplicates *outside* the workspace are never an error — they are the natural representation of several people's versions existing side by side.

## The suggestion lifecycle: materialize, then re-rank

This is the heart of the design, and it has exactly one engine operation. **There is no "accept."**

```text
suggestion              computed view: lineage drift found by diff. Not in your
                        file, nothing settled, vanishes when the comparison closes.
    │
    │  MATERIALIZE      the only engine transition.
    │                   (--write on the CLI; "take" in the app)
    ▼
(?) row in your file    an ordinary node: the proposed text, basedOn, an ID
                        minted at the next save. Yours now. Lineage settled.
    │
    │  re-rank          plain editing — the engine is not involved.
    ▼
(!) / unmarked / (+) / (-)    you took it
(x)                            you declined it — row and lineage stay, suppressing it forever
deleted line                   you removed it entirely (see open problems)
```

Materialized at `(?)` means exactly what `(?)` always means: *maybe relevant* — now with provenance attached. The row settles its lineage at the next `save` whether or not you ever touch it again; a row left at `(?)` is simply maybe-relevant content in your document. Its `basedOn` permanently accounts for the source node, reword-proof: that suggestion never comes back, no matter how either side rewords.

Everything after materialization is ordinary editing in the vocabulary you already use to rank your own content. Promoting to `(!)` or removing the marker is "taking" the suggestion; marking `(x)` is declining it while keeping the lineage record (so it stays suppressed); deleting the line removes it entirely. The engine does not distinguish these — it sees relevance edits on a normal node. Suppression never requires the engine to remember anything: the file is the memory.

## The commands

### `knowstr save [path …]`

The write-side janitor. Operates on the current directory (or explicit paths):

- assigns missing document and node IDs;
- preserves existing `basedOn`, `snapshot`, `track`, and `knowstr_vote_id` metadata;
- rejects duplicate IDs within the workspace;
- needs **no marker awareness**: a materialized suggestion row is an ordinary node with `basedOn` and a missing ID — standard normalization mints the ID, keeps `basedOn`, and baselines the edge. The `(?)` prefix is ordinary relevance vocabulary, parsed like on any other row;
- settles fetched documents whose `track:` declares a foreign upstream: fresh IDs, `basedOn` per node, baseline from the stored snapshot.

`save` writes only the workspace. It never reads or writes anything outside it.

### `knowstr diff <address> [--write]`

The product. An address is a file or a folder (later a link or group).

What it does:

1. reads the address — **read-only, always**;
2. correlates by node IDs and `basedOn` edges against the workspace — **per node, not per document**: because nodes move between containers, one foreign file may relate to several of your documents, and suggestions land wherever the related nodes live today;
3. establishes baselines on first sight (the one side effect: a write to the content-addressed snapshot store);
4. computes three-way diffs per related lineage;
5. reports.

Every foreign document falls into one of three buckets: **your deposit** (content-identical counterpart — ok, or stale when your copy has moved on), **shared lineage, diverged** (produces suggestions), or **unrelated** (shares nothing).

```text
$ knowstr diff ~/Dropbox/team
travel-plans.md
  ~ team/holidays.md          your deposit (identical) — ok
  ~ team/bob-holidays.md      shared lineage, diverged:
      (?) Montenegro           new on their side
      Kroatia                  yours, not in their copy
unrelated there: 1 document (kapital-ch3.md)
```

Correlation rules:

- **per-file namespaces** at the address: the same ID in two files there means two variants of one lineage, never a collision;
- **mirror detection**: a content-identical counterpart is reported as your deposit, never as suggestions;
- **cross-sibling dedupe**: a suggestion is keyed by what it proposes, not by which file proposes it — the same addition in three siblings is one `(?)` row;
- **nearest-shared-ancestor anchoring**: a suggestion attaches under the closest node you actually have; a foreign subtree whose ancestors you share nowhere falls into the unrelated bucket;
- **relevance is workspace-relative**: unrelated documents at a *folder* address are summarized as a count (named when few) — `diff` against a stranger's huge folder degrades to one line, not a flood. A single-*file* address was pointed at deliberately and is always reported by name.

What it does **not** do: never writes the address; never writes the workspace except under `--write`; keeps no memory of previous runs — there is no "new since last time", only "present there, absent here"; imports nothing, merges nothing, resolves nothing; doesn't browse (that is `show`).

`--write` is the bulk materializer: every suggestion lands in your files as a `(?)` row carrying provenance:

```md
- (?) Montenegro <!-- basedOn="a5" -->
```

Your documents become the inbox; triage by re-ranking in your editor, whenever you like. The materialized markup carries the source node ID — provenance, not text — which is what makes the whole lifecycle reword-proof.

### `knowstr show <address>`

Read-only render to stdout. Two uses:

- render a document or node as portable markdown (export, inspection);
- **fetch**: `knowstr show <link> > holidays.md`. Because Knowstr is the courier here, it knows the exact content at fetch time and stores the snapshot as a side effect. The fetched file carries the publisher's `track:` address, so the next `save` settles it into a clean `basedOn` fork with a perfect baseline — direction declared by the document, no questions asked.

## The app

The desktop and web apps wrap the same engine, and the diff renders entirely in UI the editor already has — split panes, overlay rows, relevance controls. No new components, no new concepts.

**Handing over an address.** The CLI takes a parameter; Electron takes a dropped file or folder (or a picker); the web takes an opened or pasted link — clicking a knowstr link someone sent you *is* `knowstr diff <address>`. Web cannot address the filesystem; desktop can do both.

**Drop = `diff`, take = `--write`.** Dropping is always safe: it opens a read-only comparison, computes everything in memory, writes nothing, and closing it forgets the whole thing (a re-drop recreates it in seconds). For a folder, the comparison opens as a summary — one row per related document, deposit status, unrelated count, and a single **"take all as `(?)`"** button, which is the bulk `--write` for the whole comparison:

```text
Dropped: ~/Dropbox/team (12 files)
  3 of your documents have 9 suggestions          [ take all as (?) ]
  ├─ travel-plans.md   5 suggestions
  ├─ budget.md         3 suggestions
  └─ reading.md        1 suggestion
  2 deposits ok, 1 stale · unrelated: 4 documents
```

Clicking through opens your document — editable, with `(?)` overlay rows sitting exactly where they would land, each attributed to its source file — beside the foreign document, read-only, in a second pane.

**Overlay rows are ghosts: any real interaction materializes them.** Set a relevance on one (the same selector every row has — choosing `(!)`, `(?)`, or `(x)` *is* "take as…"), start editing its text, or drag it somewhere in your tree — each gesture creates the ordinary node-with-`basedOn` first, then proceeds. After a restart, overlays are gone (they were a view); materialized rows remain (they are content).

**Unrelated documents get one button: "add to workspace."** App-mediated import settles at the door — fresh IDs, `basedOn` per node, baseline from the dropped bytes — because the app, unlike `cp`, knows the direction at crossing time. Import is just the take-everything special case of the same flow; nothing ever crosses the boundary silently. The same applies to all app-mediated copying (paste, drop, open-link).

The app writes only on the user's own actions. There is no watcher-driven background saving; the filesystem watcher only reflects external edits into the view.

**On the web, your workspace is the graph under your key**, bound at login — the npub is to the web what the directory is to the disk. Which gives the logged-out state a crisp identity: **no key, no workspace — the logged-out web app is a pure viewer.** It renders any address read-only; it is what a shared link opens into for someone without Knowstr. There are no placeholder identities and no pre-login editing: writing requires a workspace, everywhere. And because a key is free, local, and instant, "try it" costs one click: a visitor landing on knowstr.com with no address and no key gets a single button — generate a key, copy it to the clipboard, log in — and is typing seconds later. The same click makes one thing unmissable: the copied key *is* the account — there is no recovery, no reset, no server holding a second copy — store it somewhere safe.

## The walkthrough

Alice writes `holidays.md`, runs `knowstr save` (IDs stamped), and copies it into the team folder. Bob copies it out, adds `- Kroatia`, saves (his node gets an ID; alice's keep theirs — a born relation now spans both copies). Alice meanwhile adds Montenegro to her copy.

```sh
knowstr diff ~/Dropbox/team --write   # alice's Montenegro lands as a (?) row
vim holidays.md                       # bob re-ranks it: deletes the marker (or sets (!))
knowstr save                          # ID minted, basedOn kept, edge baselined
cp holidays.md ~/Dropbox/team/bob-holidays.md
```

Alice runs `knowstr diff ~/Dropbox/team` and sees Kroatia as `(?)` — bob's deposited file carries his `basedOn` and `snapshot` metadata, which is exactly the baseline her diff needs to attribute the change to him. She takes it the same way. Their files converge in content while remaining two documents with mutual lineage — agreement without shared mutable state.

Nobody ran a setup command. Neither can overwrite the other. Every tool that can copy a file is already a Knowstr-compatible collaboration tool.

**Late healing.** If bob had received the file with no context at all (an email, months ago) and absorbed it as his own, nothing is lost: the first time a `diff` exposes both sides, the shared IDs reveal the relation, a baseline is taken from that moment, and suggestions flow from then on. Whatever alice changed before first contact is missed; nothing corrupts. A context-free copy is fundamentally indistinguishable from original content — Knowstr handles it by converging late instead of guessing early.

## Topologies

These are usage patterns, not features — Knowstr only ever sees "an address":

| Arrangement | How | Who reads whom |
| --- | --- | --- |
| **Team folder** | everyone deposits copies into one folder, everyone diffs it | all ↔ all |
| **Follower** | alice deposits into her own public folder; followers diff it | one → many |
| **Pairwise, ad hoc** | bob emails a file; carol diffs (or drops) the attachment directly | one ↔ one |

A deposit is a `cp` toward the folder; it is a projection of the owner's workspace truth, refreshed by re-copying (the diff report nags when a deposit goes stale). Simultaneous editing of one shared file is the transport's job (git merge, Dropbox conflict copies) — Knowstr reads whatever ends up there and never writes it.

## Staged layers

Each layer exists to relieve a specific friction in the nucleus, in the order the pain proves itself. None changes the model.

1. **`fork <file>`** — eager settling: fresh IDs + `basedOn` + baseline on demand. Also the answer `save` suggests for workspace-duplicate rejections, and the basis for deliberate self-variants. The editor already surfaces self-variants: a fork shows on its original as a version row ("another version of this document, +5/−2") with its drift as `(?)` suggestions — workspace-internal today; the app phase feeds the same rows from foreign addresses.
2. **`share <file>`** — publishing to relays: the one verb that needs an identity. Stamps a durable `track:` address (a knowstr.com link) into the document so every copy of it, however it travels, is self-connecting. Relays then become a **rendezvous**: queryable by the node IDs themselves, so variants of your documents are discoverable without anyone sending links. Honest limits to settle there: discovery only happens on relays both sides use (a default relay set is what makes it feel like one global place), snapshot events must move to a non-replaceable kind, and the local↔relay sync story (encryption or access-controlled relays) must be settled before private content publishes.
3. **Groups** — a shared address with membership: an access-controlled relay is rendezvous, storage, and membership in one thing users already understand ("the group's server"). Token/membership management out of scope.

Also staged: `detach` (deliberately break lineage), voting aggregates over `knowstr_vote_id` (the field is preserved today and stays preserved), and `accept <ref>` as sugar for materialize-plus-set-relevance in one command.

## Open problems

Decisions we have deliberately not made yet. The nucleus is complete without them.

### Where do updates come from, automatically?

The nucleus runs entirely on **explicit addresses** — typed on the CLI, dropped on the desktop, opened as a link on the web — and every use case works that way today. Remembering addresses so the user doesn't repeat the gesture is a convenience layer with several competing designs: `track:` addresses carried inside files (self-connecting documents — but fragment copies and groups strain it), a small workspace-level "places I'm in" list, relays-as-rendezvous (the `share` layer's discovery property promoted to the mechanism), sender-delivers-to-your-inbox, and an ambient local crawler. Each fails some use case the others handle. Decide from usage pain, not theory.

### When does the baseline advance?

Materialized rows suppress themselves through lineage — including `(x)` declines — so this question is narrower than it looks: it only governs **rows the user deletes outright**. Delete a materialized row and only an *advanced* base lets the three-way diff read the absence as your deletion and stay silent; a frozen base re-offers it forever. Candidates: advance at `--write` time (an offer, once made, is recorded), or never advance (deletions resurface). Never-materialized suggestions resurfacing is correct behavior — undecided is undecided.

### Change types beyond added/absent

The three-way diff currently sees presence and absence of children. Modifications (rewording a node) and re-rankings (`(!)` → `(x)`) are invisible — yet re-ranking is exactly the signal that matters for weighting use cases (investors ranking locations), and modification is what an updated task document mostly consists of. Needs: modified/re-ranked as attributable suggestion types, and a materialization form for each.

## Invariants

- Knowstr writes only the user's workspace. Addresses are read-only, always.
- Node IDs are unique within a workspace; duplicates elsewhere are variants, not errors.
- Identity, lineage, and suppression come from IDs and `basedOn` only — never from text equality, never from author metadata, never from run logs.
- All relational state is node-level (`id`, `basedOn`, `snapshot`); documents are containers, nothing more.
- `diff` is stateless and workspace-relative; a suggestion is a computed view until materialized; **materialization is the only engine transition** — everything after it is ordinary editing of ordinary nodes.
- `(?)` is the editor's normal relevance vocabulary; "accept" is not an operation anywhere in the system.
- Snapshots are immutable, content-addressed, node-referenced, and disposable (loss self-heals by re-baselining).
- Re-minting IDs happens only in the workspace, only at moments that know the direction: materialization, settling a `track:`-declared fetch, app-mediated copying, and the explicit `fork` layer.
- A context-free copy is unknowable until first contact; Knowstr converges late instead of guessing early.
- Transport security, access control, merge conflicts on shared files, and signatures belong to the transport, not the graph model.
