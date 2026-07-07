import { List, Map as ImmutableMap } from "immutable";
import { renderDocumentMarkdown } from "../../documentRenderer";
import { LOCAL } from "../nodeRef";
import { plainSpans } from "../nodeSpans";

// Dismissal is the baseline's job, never a field (idea.md, the
// subscription law). Dismissing a replacement-shaped rename suggestion
// advances the edge to a CONSTRUCTED baseline. A baseline needs not be a
// historical version — this one is rendered deterministically and
// content-addressed like any snapshot.
//
// The edge has TWO base texts, one per endpoint; a historical snapshot
// records only the origin's (the fork copied it, so they start equal).
// A dismissal breaks that equality, so the constructed baseline records
// both endpoints explicitly: the dismissed side's record advances to
// their current text ("I processed their text up to this version"),
// while my endpoint keeps its old base text as a childless leaf record —
// so the OTHER side's diff, which reads my endpoint's record, is
// untouched by my dismissal. Children stay the origin's: a dismissal
// advances text only, so the child suggestions on both sides keep
// running against the old children. Their NEXT rename differs from this
// baseline and surfaces fresh: it mutes a version, not a row.
export function constructDismissalBaseline(
  snapshotMap: ImmutableMap<string, GraphNode>,
  edge: {
    versionId: string;
    mineId: string;
    originId: string;
    theirsText: string;
  }
): string | undefined {
  const origin = snapshotMap.get(edge.originId);
  if (!origin) {
    return undefined;
  }
  const leaf = (id: string, spans: InlineSpan[]): GraphNode => ({
    children: List<ID>(),
    id: id as ID,
    spans,
    updated: 0,
    root: id as ID,
    relevance: origin.relevance,
  });
  const existingVersion = snapshotMap.get(edge.versionId);
  const withVersion = snapshotMap.set(
    edge.versionId,
    existingVersion
      ? { ...existingVersion, spans: plainSpans(edge.theirsText) }
      : leaf(edge.versionId, plainSpans(edge.theirsText))
  );
  const updated = withVersion.has(edge.mineId)
    ? withVersion
    : withVersion.set(edge.mineId, leaf(edge.mineId, origin.spans));
  // Endpoint leaves render BEFORE the original roots: a top-level bullet
  // after a heading root would be adopted as its child on reparse.
  const addedLeaves = [edge.versionId, edge.mineId].filter(
    (id) => !snapshotMap.has(id) && updated.get(id)?.parent === undefined
  );
  const topIds = [
    ...addedLeaves,
    ...updated
      .valueSeq()
      .toArray()
      .filter(
        (node) => node.parent === undefined && !addedLeaves.includes(node.id)
      )
      .map((node) => node.id),
  ];
  const knowledgeDBs = ImmutableMap<SourceId, KnowledgeData>({
    [LOCAL]: { nodes: updated },
  });
  return renderDocumentMarkdown(knowledgeDBs, {
    sourceId: LOCAL,
    docId: "baseline",
    topNodeShortIds: topIds,
    updatedMs: 0,
    title: "",
  });
}
