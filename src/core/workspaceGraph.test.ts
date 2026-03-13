/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import {
  planInsertMarkdownUnderRelationById,
  planLinkRelationById,
  planMoveRelationItemById,
  planRemoveRelationItemById,
  planSetRelationTextById,
  planUpdateRelationItemMetadataById,
} from "../dataPlanner";
import { parseDocumentEvent } from "../markdownRelations";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { findTag } from "../nostrEvents";
import {
  buildSingleRootMarkdownDocumentEvent,
  requireSingleRootMarkdownTree,
} from "../standaloneDocumentEvent";
import {
  buildKnowledgeDocumentEvents,
  createHeadlessPlan,
} from "./headlessPlan";
import { inspectChildren, loadWorkspaceGraph } from "./workspaceGraph";

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

function parseRootRelations(draft: WorkspaceDraft): GraphNode[] {
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
  expect(result.skipped_document_count).toBe(0);
  expect(result.children.map((item) => item.text)).toEqual(["Plan", "Notes"]);
  expect(result.children.every((item) => item.kind === "relation")).toBe(true);
  expect(result.children.every((item) => item.relevance === "contains")).toBe(
    true
  );
});

test("loadWorkspaceGraph skips rootless documents instead of aborting", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(ALICE, "# Home\n");
  writeWorkspace(tempDir, [homeDraft]);
  const emptyDocumentPath = path.join(
    tempDir,
    "DOCUMENTS",
    ALICE,
    "empty-document.md"
  );
  fs.writeFileSync(emptyDocumentPath, "", "utf8");
  fs.writeFileSync(
    path.join(tempDir, "manifest.json"),
    JSON.stringify(
      {
        ...JSON.parse(
          fs.readFileSync(path.join(tempDir, "manifest.json"), "utf8")
        ),
        documents: [
          manifestDocument(homeDraft, 0),
          {
            replaceable_key: `${KIND_KNOWLEDGE_DOCUMENT}:${ALICE}:empty-document`,
            author: ALICE,
            event_id: "event-empty",
            d_tag: "empty-document",
            path: `DOCUMENTS/${ALICE}/empty-document.md`,
            created_at: homeDraft.event.created_at,
            updated_ms: homeDraft.event.created_at * 1000,
          },
        ],
      },
      null,
      2
    )
  );

  const graph = await loadWorkspaceGraph(tempDir);
  const result = inspectChildren(graph, ALICE, homeDraft.relationID);

  expect(graph.skippedDocuments).toEqual([
    `DOCUMENTS/${ALICE}/empty-document.md`,
  ]);
  expect(result.skipped_document_count).toBe(1);
  expect(result.relation_id).toBe(homeDraft.relationID);
});

test("setRelationText, setItemRelevance, and setItemArgument republish the same root with updated edge metadata", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Plan\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const graph = await loadWorkspaceGraph(tempDir);
  const plan = createHeadlessPlan(ALICE, graph.knowledgeDBs);
  const planRelation = parseRootRelations(homeDraft).find(
    (relation) => relation.text === "Plan"
  );
  expect(planRelation).toBeDefined();

  const renamedPlan = planSetRelationTextById(
    plan,
    planRelation?.id as LongID,
    "Updated Plan"
  );
  const reweightedPlan = planUpdateRelationItemMetadataById(
    renamedPlan,
    homeDraft.relationID,
    planRelation?.id as LongID,
    {
      relevance: "not_relevant",
    }
  );
  const arguedPlan = planUpdateRelationItemMetadataById(
    reweightedPlan,
    homeDraft.relationID,
    planRelation?.id as LongID,
    {
      argument: "contra",
    }
  );
  const [event] = buildKnowledgeDocumentEvents(arguedPlan);
  const nodes = parseDocumentEvent(event).valueSeq().toArray();
  const republishedHome = nodes.find(
    (relation) => relation.id === homeDraft.relationID
  );
  const republishedPlan = nodes.find(
    (relation) => relation.id === (planRelation?.id as LongID)
  );

  expect(republishedPlan?.text).toBe("Updated Plan");
  expect(republishedHome?.children.first()?.relevance).toBe("not_relevant");
  expect(republishedHome?.children.first()?.argument).toBe("contra");
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
  const plan = createHeadlessPlan(ALICE, graph.knowledgeDBs);

  const created = planInsertMarkdownUnderRelationById(
    plan,
    homeDraft.relationID,
    [requireSingleRootMarkdownTree("# Notes\n\n## Detail\n")],
    undefined,
    "maybe_relevant",
    "confirms"
  );
  const linked = planLinkRelationById(
    created.plan,
    homeDraft.relationID,
    roadmapDraft.relationID
  );
  const events = buildKnowledgeDocumentEvents(linked.plan);
  const event = events.find(
    (candidate) => findTag(candidate, "d") === homeDraft.rootUuid
  );

  expect(event?.content).toContain("- Notes {");
  expect(event?.content).toContain(".maybe_relevant .confirms");
  expect(event?.content).toContain(`[Roadmap](#${roadmapDraft.relationID})`);
  expect(
    events.filter((candidate) => candidate.kind === KIND_KNOWLEDGE_DOCUMENT)
  ).toHaveLength(1);
});

test("moveItem preserves relevance and argument across parents, and delete-item semantics delete owned subtrees", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Bucket A\n\n### Task {.relevant .contra}\n\n## Bucket B\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const graph = await loadWorkspaceGraph(tempDir);
  const plan = createHeadlessPlan(ALICE, graph.knowledgeDBs);
  const nodes = parseRootRelations(homeDraft);
  const bucketA = nodes.find((relation) => relation.text === "Bucket A");
  const bucketB = nodes.find((relation) => relation.text === "Bucket B");
  const task = nodes.find((relation) => relation.text === "Task");

  expect(bucketA).toBeDefined();
  expect(bucketB).toBeDefined();
  expect(task).toBeDefined();

  const movedPlan = planMoveRelationItemById(
    plan,
    bucketA?.id as LongID,
    task?.id as LongID,
    bucketB?.id as LongID,
    0
  );
  const [movedEvent] = buildKnowledgeDocumentEvents(movedPlan);
  const movedRelations = parseDocumentEvent(movedEvent).valueSeq().toArray();
  const movedBucketA = movedRelations.find(
    (relation) => relation.id === bucketA?.id
  );
  const movedBucketB = movedRelations.find(
    (relation) => relation.id === bucketB?.id
  );

  expect(movedBucketA?.children.size).toBe(0);
  expect(movedBucketB?.children.first()?.id).toBe(task?.id);
  expect(movedBucketB?.children.first()?.relevance).toBe("relevant");
  expect(movedBucketB?.children.first()?.argument).toBe("contra");

  const removedPlan = planRemoveRelationItemById(
    movedPlan,
    bucketB?.id as LongID,
    task?.id as LongID
  );
  const [removedEvent] = buildKnowledgeDocumentEvents(removedPlan);
  const removedRelations = parseDocumentEvent(removedEvent)
    .valueSeq()
    .toArray();
  const removedBucketB = removedRelations.find(
    (relation) => relation.id === bucketB?.id
  );

  expect(removedRelations.find((relation) => relation.id === task?.id)).toBe(
    undefined
  );
  expect(removedBucketB?.children.find((item) => item.id === task?.id)).toBe(
    undefined
  );
});

test("moveItem rejects moving a relation under its own descendant", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-workspace-"));
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    ALICE,
    "# Home\n\n## Parent\n\n### Child\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const graph = await loadWorkspaceGraph(tempDir);
  const plan = createHeadlessPlan(ALICE, graph.knowledgeDBs);
  const nodes = parseRootRelations(homeDraft);
  const parent = nodes.find((relation) => relation.text === "Parent");
  const child = nodes.find((relation) => relation.text === "Child");

  expect(parent).toBeDefined();
  expect(child).toBeDefined();

  expect(() =>
    planMoveRelationItemById(
      plan,
      homeDraft.relationID,
      parent?.id as LongID,
      child?.id as LongID,
      0
    )
  ).toThrow("Cannot move relation");
});
