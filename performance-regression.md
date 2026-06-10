# Performance regression audit

Updated 2026-06-10 with measured data. Full-suite `npm test` wall time roughly doubled after the row-model migration (`34286bb`): ~30s before, ~63–65s now. `src/editor/IncomingRefInteraction.test.tsx` is the long pole (~62s in the parallel run, ~35s alone); that test file is byte-identical before/after `34286bb`, so the slowdown is purely production-code behavior.

## Measured and fixed

1. **Per-row-render bech32 decode (fixed).** `getDisplayTextForRow`, `Node`, and `RightMenu` call `getNodeUserPublicKey(node)` on every row render; it ran `nip19.decode` on arbitrary node text (twice on the miss path). CPU profile: 2.7s self-time in `@scure/base decode` in the slow suite alone. Fixed in `src/infra/nostr/publicKeys.ts` by testing the hex shape first and requiring an `npub1`/`nprofile1` prefix before attempting `nip19.decode`. Won ~2s of full-suite wall time.

## Measured and disproved (do not re-investigate without new evidence)

- `getIncomingCrefsForNode` per-row subtree walks: 4,600 calls in the slow suite cost **173ms** total; `coveredDocumentKeys` did 5,956 node visits over 5,000 calls (trees are shallow). Real in theory, negligible in practice.
- `getAlternativeFooterData`: 286ms total in the slow suite.
- Traversal overall: `getNodesInTree` + `getNodesInDocument` inclusive ≈ **0.8s** of 36.6s.
- Row render volume: ~8,000 `ListItem` renders across the whole suite (~240/test) — typing does not re-render the tree.
- All-DB scans: `findUniquePlanNodeByID` is deleted; the only remaining all-node scan (`logNodeNotFoundDebug` in `src/editor/Node.tsx`) is gated behind `DEBUG_NODE_NOT_FOUND=1` and dormant.

## Remaining (diffuse, needs baseline comparison to attribute)

Post-fix profile of the slow suite (36.6s in-band): jsdom 6.9s, idle 6.8s, react-dom 6.4s, other deps 4.2s, app src 3.8s (no file above 0.7s self). The cost is per-synthetic-event dispatch (`user-event` keyboard 8.6s + pointer 3.1s inclusive) and the React re-renders they trigger — flat across hundreds of frames, no single hotspot.

Open leads, in order of suspicion:

1. **Idle/timer waits (6.8s in-band).** Consistent with ~136 `waitFor`/`findBy` 50ms polling ticks. If state updates now settle one timer tick later than before (queue/scheduling change), every await in every suite pays 50ms.
2. **Event signing inside keystrokes.** ~0.7s of `@noble/curves` secp256k1 work under `keyboard` events — plans are signed synchronously during typing interactions.
3. **Per-event React/jsdom cost** (DOM size per row, dev-mode checks like `updatedAncestorInfo`, per-row `RowContext.Provider` propagation).

Attributing the residual requires timing the same suite at the pre-migration commit (e.g. a throwaway worktree at `3e1203b`) — without that baseline, further optimization is forward-looking tuning, not regression hunting.

## Tooling

CPU profile: `node --cpu-prof --cpu-prof-dir=<dir> node_modules/.bin/jest <suite> --runInBand`, then aggregate self/inclusive time from the `.cpuprofile` (analysis scripts used for this audit were throwaway, under `/tmp/prof/`).

## Acceptance

- No `graphLookupFromData(data)` construction in per-row or per-link render paths (one known remaining: `nodeTarget` in `src/editor/linkOperations.ts`, measured cheap).
- No hot-path all-DB/all-node fallback scans.
- Full-suite `npm test` wall time returns to roughly the pre-migration baseline (~30–40s), with the residual attributed via baseline comparison first.
