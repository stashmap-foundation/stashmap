/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { parseDocumentEvent } from "../markdownRelations";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { buildSingleRootMarkdownDocumentEvent } from "../standaloneDocumentEvent";
import {
  buildWorkspaceDocumentEvents,
  createUnderParent,
  inspectChildren,
  linkUnderParent,
  loadWorkspaceGraph,
  moveItem,
  removeItem,
  setItemArgument,
  setItemRelevance,
  setRelationText,
} from "./workspaceGraph";

const ALICE = "a".repeat(64) as PublicKey;

type WorkspaceDraft = ReturnType<typeof buildSingleRootMarkdownDocumentEvent>;

function manifestDocument(
  draft: WorkspaceDraft,
  index: number
): {
  replaceable_key: string;
  author: PublicKey;
  event_id: string;
  d_tag: string;
  path: string;
  created_at: number;
  updated_ms: number;
} {
  return {
    replaceable_key: `${KIND_KNOWLEDGE_DOCUMENT}:${draft.event.pubkey}:${draft.rootUuid}`,
    author: draft.event.pubkey as PublicKey,
    event_id: `event-${index}`,
    d_tag: draft.rootUuid,
    path: `DOCUMENTS/${draft.event.pubkey}/${draft.rootUuid}.md`,
    created_at: draft.event.created_at,
    updated_ms: draft.event.created_at * 1000,
  };
}

function writeWorkspace(tempDir: string, drafts: WorkspaceDraft[]): void {
  const documents = drafts.map((draft, index) =>
    manifestDocument(draft, index)
  );
  documents.forEach((document, index) => {
    const filePath = path.join(tempDir, document.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, drafts[index]?.event.content || "", "utf8");
  });
  fs.writeFileSync(
    path.join(tempDir, "manifest.json"),
    JSON.stringify(
      {
        workspace_version: 1,
        as_user: ALICE,
        synced_at: "2026-03-11T12:00:00.000Z",
        relay_urls: ["wss://relay.example/"],
        contact_pubkeys: [],
        authors: [
          {
            pubkey: ALICE,
            last_document_created_at: Math.max(
              ...drafts.map((draft) => draft.event.created_at)
            ),
          },
        ],
        documents,
      },
      null,
      2
    )
  );
}

function parseRootRelations(draft: WorkspaceDraft): Relations[] {
  return parseDocumentEvent(draft.event).valueSeq().toArray();
}

test("inspectChildren lists stable child item ids from the synced workspace", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Plan\n\n## Notes\n"
  );
  writeWorkspace(tempDir, [homeDraft]);

  const graph = await loadWorkspaceGraph(tempDir);
  const result = inspectChildren(graph, ALICE, homeDraft.relationID);

  expect(result.relation_id).toBe(homeDraft.relationID);
  expect(result.items.map((item) => item.text)).toEqual(["Plan", "Notes"]);
  expect(result.items.every((item) => item.kind === "relation")).toBe(true);
  expect(result.items.every((item) => item.relevance === "contains")).toBe(
    true
  );
});

test("setRelationText, setItemRelevance, and setItemArgument republish the same root with updated edge metadata", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Plan\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const graph = await loadWorkspaceGraph(tempDir);
  const planRelation = parseRootRelations(homeDraft).find(
    (relation) => relation.text === "Plan"
  );
  expect(planRelation).toBeDefined();

  const renamed = setRelationText(
    graph,
    ALICE,
    planRelation?.id as LongID,
    "Updated Plan"
  );
  const reweighted = setItemRelevance(
    {
      ...graph,
      knowledgeDBs: renamed.knowledgeDBs,
    },
    ALICE,
    homeDraft.relationID,
    planRelation?.id as LongID,
    "not_relevant"
  );
  const argued = setItemArgument(
    {
      ...graph,
      knowledgeDBs: reweighted.knowledgeDBs,
    },
    ALICE,
    homeDraft.relationID,
    planRelation?.id as LongID,
    "contra"
  );
  const [event] = buildWorkspaceDocumentEvents(
    argued.knowledgeDBs,
    argued.rootRelationIds,
    ALICE
  );
  const relations = parseDocumentEvent(event).valueSeq().toArray();
  const republishedHome = relations.find(
    (relation) => relation.id === homeDraft.relationID
  );
  const republishedPlan = relations.find(
    (relation) => relation.id === (planRelation?.id as LongID)
  );

  expect(republishedPlan?.text).toBe("Updated Plan");
  expect(republishedHome?.items.first()?.relevance).toBe("not_relevant");
  expect(republishedHome?.items.first()?.argument).toBe("contra");
});

test("createUnderParent and linkUnderParent add owned children and crefs to the existing root", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(ALICE, "# Home\n");
  const roadmapDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Roadmap\n"
  );
  writeWorkspace(tempDir, [homeDraft, roadmapDraft]);
  const graph = await loadWorkspaceGraph(tempDir);

  const created = createUnderParent(
    graph,
    ALICE,
    homeDraft.relationID,
    "# Notes\n\n## Detail\n",
    {},
    "maybe_relevant",
    "confirms"
  );
  const linked = linkUnderParent(
    {
      ...graph,
      knowledgeDBs: created.knowledgeDBs,
    },
    ALICE,
    homeDraft.relationID,
    roadmapDraft.relationID,
    {}
  );
  const [event] = buildWorkspaceDocumentEvents(
    linked.knowledgeDBs,
    linked.rootRelationIds,
    ALICE
  );

  expect(event.content).toContain("- Notes {");
  expect(event.content).toContain(".maybe_relevant .confirms");
  expect(event.content).toContain(`[Roadmap](#${roadmapDraft.relationID})`);
});

test("moveItem preserves relevance and argument across parents, and removeItem deletes owned subtrees", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Bucket A\n\n### Task {.relevant .contra}\n\n## Bucket B\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const graph = await loadWorkspaceGraph(tempDir);
  const relations = parseRootRelations(homeDraft);
  const bucketA = relations.find((relation) => relation.text === "Bucket A");
  const bucketB = relations.find((relation) => relation.text === "Bucket B");
  const task = relations.find((relation) => relation.text === "Task");

  expect(bucketA).toBeDefined();
  expect(bucketB).toBeDefined();
  expect(task).toBeDefined();

  const moved = moveItem(
    graph,
    ALICE,
    bucketA?.id as LongID,
    task?.id as LongID,
    bucketB?.id as LongID,
    {}
  );
  const [movedEvent] = buildWorkspaceDocumentEvents(
    moved.knowledgeDBs,
    moved.rootRelationIds,
    ALICE
  );
  const movedRelations = parseDocumentEvent(movedEvent).valueSeq().toArray();
  const movedBucketA = movedRelations.find(
    (relation) => relation.id === bucketA?.id
  );
  const movedBucketB = movedRelations.find(
    (relation) => relation.id === bucketB?.id
  );

  expect(movedBucketA?.items.size).toBe(0);
  expect(movedBucketB?.items.first()?.id).toBe(task?.id);
  expect(movedBucketB?.items.first()?.relevance).toBe("relevant");
  expect(movedBucketB?.items.first()?.argument).toBe("contra");

  const removed = removeItem(
    {
      ...graph,
      knowledgeDBs: moved.knowledgeDBs,
    },
    ALICE,
    bucketB?.id as LongID,
    task?.id as LongID
  );
  const [removedEvent] = buildWorkspaceDocumentEvents(
    removed.knowledgeDBs,
    removed.rootRelationIds,
    ALICE
  );
  const removedRelations = parseDocumentEvent(removedEvent)
    .valueSeq()
    .toArray();

  expect(removedRelations.find((relation) => relation.id === task?.id)).toBe(
    undefined
  );
});
