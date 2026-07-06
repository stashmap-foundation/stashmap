/* eslint-disable functional/no-let, functional/immutable-data */
import { MergeSuggestion } from "./types";
import { parseDoc } from "./kernel";
import { getBlockLinkTarget, isBlockLink, nodeText } from "../nodeSpans";

// Display modes of the kernel: take (join by id, baseline present), fork
// (join by basedOn, baseline present) and the entity surface (join by id,
// no baseline — additions and drift only, nothing destructive ever).
// Output is display data; nothing here ever writes.

export type DiffInput = {
  mine: string;
  theirs: string[];
  baseline?: string;
  join: "id" | "basedOn";
};

export type DiffResult = {
  suggestions: MergeSuggestion[];
  drift: number;
};

function canonical(node: GraphNode | undefined): string {
  return node ? JSON.stringify(node.spans) : "";
}

export function diffVersions(input: DiffInput): DiffResult {
  const mine = parseDoc(input.mine);
  const baseline = input.baseline ? parseDoc(input.baseline) : undefined;

  const heldIds = new Set(mine.nodes.keySeq().toArray().map(String));
  const heldOrigins = new Set(
    mine.nodes
      .valueSeq()
      .toArray()
      .map((node) => node.basedOn)
      .filter((origin): origin is ID => origin !== undefined)
      .map(String)
  );
  const linkedTargets = new Set(
    mine.nodes
      .valueSeq()
      .toArray()
      .filter((node) => isBlockLink(node))
      .map((node) => getBlockLinkTarget(node))
      .filter((target): target is ID => target !== undefined)
      .map(String)
  );

  // Never suggest what I hold: by id (H1 — `(x)` included, H4), as a fork
  // (H2), or as a link row targeting it (H3). With a baseline, my
  // deliberate deletions stay deleted (T-mode side of the asymmetry);
  // without one, deletion cannot be told from never-had (E-mode side).
  const covered = (id: string): boolean =>
    heldIds.has(id) ||
    heldOrigins.has(id) ||
    linkedTargets.has(id) ||
    (baseline !== undefined && baseline.nodes.has(id));

  const suggestions: MergeSuggestion[] = [];
  const suggestedKeys = new Set<string>();
  let drift = 0;

  input.theirs.forEach((theirsMd) => {
    const theirs = parseDoc(theirsMd);

    // Correlate node pairs.
    const pairs: { mineId: string; theirsId: string }[] = [];
    if (input.join === "id") {
      theirs.nodes.keySeq().forEach((id) => {
        if (mine.nodes.has(id)) {
          pairs.push({ mineId: String(id), theirsId: String(id) });
        }
      });
    } else {
      mine.nodes.forEach((node, id) => {
        if (node.basedOn && theirs.nodes.has(node.basedOn)) {
          pairs.push({ mineId: String(id), theirsId: String(node.basedOn) });
        }
      });
      theirs.nodes.forEach((node, id) => {
        if (node.basedOn && mine.nodes.has(node.basedOn)) {
          pairs.push({ mineId: String(node.basedOn), theirsId: String(id) });
        }
      });
    }

    pairs.forEach(({ mineId, theirsId }) => {
      const m = mine.nodes.get(mineId);
      const t = theirs.nodes.get(theirsId);
      if (!m || !t) return;

      // Text drift on the correlated pair. Each endpoint of a fork edge
      // has its own base text: a dismissal-constructed baseline records
      // the version's endpoint under its own id (historical snapshots
      // carry only the shared origin record), so a dismissal on one side
      // never changes what the other side sees.
      if (canonical(m) !== canonical(t)) {
        const originKey =
          input.join === "id" ? mineId : String(m.basedOn ?? mineId);
        const bTheirs =
          baseline?.nodes.get(theirsId) ?? baseline?.nodes.get(originKey);
        if (bTheirs !== undefined && canonical(t) !== canonical(bTheirs)) {
          const key = `text:${mineId}`;
          if (!suggestedKeys.has(key)) {
            suggestedKeys.add(key);
            suggestions.push({
              kind: "text",
              node: mineId,
              theirs: nodeText(t),
            });
          }
        } else if (bTheirs === undefined) {
          drift += 1; // I2: ± only, no direction, no proposal
        }
      }

      // Their children under the correlated parent → additions.
      t.children.forEach((childId) => {
        const child = theirs.nodes.get(childId);
        if (!child) return;
        const originKey = String(child.basedOn ?? childId);
        if (covered(String(childId)) || covered(originKey)) return;
        const key = `add:${mineId}:${originKey}`;
        if (suggestedKeys.has(key)) return; // H5: one row across sources
        suggestedKeys.add(key);
        suggestions.push({
          kind: "add",
          parent: mineId,
          node: String(childId),
          theirs: nodeText(child),
        });
      });
    });
  });

  return { suggestions, drift };
}
