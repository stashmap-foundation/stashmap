# The Knowstr format

Knowstr files are plain markdown with a few extras. The goal: several people work with the same source material — reorder it, mark what matters, remove noise, add their own thoughts — **without editing a shared document and without overwriting each other**.

## The building blocks

Every row gets an id. Then there are a few kinds of statements:

```markdown
- A row of my own text <!-- id:a1 -->
- (!) relevant   (?) unclear   (~) little relevant   (x) not relevant
- (+) supports its parent   (-) contradicts its parent
- [Some source row](#s1) <!-- id:a2 embed="true" -->
```

The first markers rank relevance, from `(!)` down to `(x)`; a row marked `(x)` is hidden from my view.

The last line is an **embed**: "show that row here". It displays the source's *current* text and children — my file only stores the link.

Two more gestures:

```markdown
- My own summary ~~[their original words](#s2)~~ <!-- id:a3 embed="true" -->
- A moved row <!-- id:a4 after="s5" -->
```

The first is a **rewording**: my words show instead of theirs, but the crossed-out link keeps the connection.

The second is a **move**. When I drag a row, the file records exactly one anchor — the row it now sits behind, or the parent it now leads:

```markdown
- A moved row <!-- id:a4 after="s5" -->
- A row moved to the front <!-- id:a5 parent="s2" -->
```

`after=` names the row above it; `parent=` names the row whose children it now leads. Never both — a second name could contradict the first. The idea: position is claimed relative to *rows*, never as "third from the top". So when the author reorders their document, my row travels with its named row — even when that row is itself a moved one, so resorting a whole list is a chain of `after=` claims. If the named row disappears, my row parks visibly where it is written until I drag it again. If several rows claim the same anchor — possible only in hand-written or merged files, the app never writes two claims on one anchor — the order of their lines in my file breaks the tie. Rows I never dragged carry no names and simply follow the source order.

## The diff idea

My file never contains the source — only my statements about it. Example: I keep a colleague's venue brief but judge it my way.

Their file:

```markdown
# Zagreb venue brief <!-- id:z1 -->
- The venue seats thirty people <!-- id:z2 -->
- The station is fifteen minutes away <!-- id:z3 -->
  - Direct train from the airport <!-- id:z4 -->
- Local tax incentives <!-- id:z5 -->
- Nearby tourist attractions <!-- id:z6 -->
```

My file, complete: I mark two rows, dismiss one, drag the attractions row up above the station, add a note under one of their rows, and add a question of my own.

```markdown
# Should we meet in Zagreb? <!-- id:q1 -->
- [Zagreb venue brief](#z1) <!-- id:q2 embed="true" -->
  - (!) [The venue seats thirty people](#z2) <!-- id:q3 embed="true" -->
  - Enough for the whole Salon <!-- id:q4 parent="z2" -->
  - (~) [Nearby tourist attractions](#z6) <!-- id:q5 embed="true" after="z2" -->
  - (x) [Local tax incentives](#z5) <!-- id:q6 embed="true" -->
  - We still need a hotel recommendation <!-- id:q7 -->
```

Two things to notice about the shape:

- **The diff is flat.** All my statements sit one level under the embed, whatever the source's tree looks like. Where a row *shows* is said by its anchor: my note `q4` carries `parent="z2"`, so it renders under the seats row, and the dragged attractions row carries `after="z2"` — the seats row is now the row above it. The statement line itself never nests or moves to mirror the source.
- **The diff is sparse.** The station row and its child appear nowhere in my file — I made no statement about them, so they're simply omitted.
- **The diff contains user intent** It's clear that this row is here, because the user marked its relevance or moved it (or both).

What I see on screen is computed by laying my diff over their live document:

```text
Should we meet in Zagreb?
└─ Zagreb venue brief
   ├─ (!) The venue seats thirty people
   │      └─ Enough for the whole Salon          ← my note, placed by parent="z2"
   ├─ (~) Nearby tourist attractions             ← moved up by after="z2"
   ├─ The station is fifteen minutes away        ← untouched, flows in from the source
   │      └─ Direct train from the airport
   └─ We still need a hotel recommendation       ← my addition
```

Everything I didn't touch flows in from the source, in the source's order. The tax row is gone because I marked it `(x)`. This composed view is never saved anywhere — the two files are the only truth.

## Why this format

- **Corrections flow through.** If the author fixes a typo, every embed shows the fix — except rows I reworded, which stay mine.
- **Nobody overwrites anybody.** My rows are mine, theirs are theirs. Their edits can't destroy my notes; my notes change nothing for them.
- **Feedback works.** In a group, everyone's marks on the same rows can be counted: 12 marked this important, 4 rejected it. Because everything is keyed by id, that survives even when the author reorganizes.
- **Nothing silently lies.** If the author deletes a row I annotated, my row stays and is visibly flagged. If they change text I judged, both wordings are shown.
- **It's just text.** Any editor works, files are readable and diffable, and no app can lock the content in.
- **Agents can read and write it.** An agent gets the composed view as plain markdown, ids included, and contributes exactly like a person: plain rows, markers, links. No API, no database — the file is the interface.

## Why it fits deedsats

- **An asset is exactly this shape.** Buying an asset gives you a curated body of material from its operator — and the format's whole point is one trusted author plus many readers who personalize without touching the original. No forum, no wiki, no moderation problem: holders can't write into the operator's document, only lay their own view over it.
- **Feedback is the product.** The operator sees what holders actually think: 12 marked this important, 4 rejected it, 7 moved it up — counted from signed statements, per row. That works without building voting infrastructure, and it survives the operator reorganizing the document, because every statement is keyed to a row id, not a position.

## What we decided against

- **One shared document (Google-Docs style).** Merging everyone's edits into one text destroys attribution — for feedback you need to know whose statement each row is. And a merged text is something nobody actually wrote. Early experiments with roamresearch showed that their multi user model which is exactly this, doesn't fit the scholarium usecase. Other users comments and edits are usually just noise and should maximal be suggestions.
- **Version-based merging (the git approach).** We built this first and threw it away. It needs stored base versions, merge logic, and conflict handling — lots of machinery answering "what changed since when?" The current model only asks "what do the two files say right now?" and "What was the users intent?" (Move A before B), which is a simple, deterministic computation.
- **Copying the source into my file.** Copies go stale, and a copy gets a new id — so feedback already collected on the original is lost. Embeds keep the id, so text stays live and feedback adds up.
- **JSON or a database.** Not hand-writable, not readable as text, and it ties the content to one app.


## Weakness

- *Moving Target* The underlying source can still be editet by the original author. The diff might refer to rows
  which don't exist anymore. We will show them as dangling, which can be annoying for the user. This format is
  not made for the original author to heavily reorganise documents after publishing, but to correct errors and
  add user feedback if it's useful
