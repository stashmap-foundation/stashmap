/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { shortID } from "../connections";
import { parseDocumentEvent } from "../markdownRelations";
import { buildSingleRootMarkdownDocumentEvent } from "../standaloneDocumentEvent";
import { loadPendingWriteEntries } from "./pendingWrites";
import { loadWorkspaceGraph } from "./workspaceGraph";
import { writeLink, writeMoveItem, writeSetText } from "./writeWorkspace";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;
const OTHER_PRIVATE_KEY = "2".repeat(64);
const OTHER_PUBKEY = getPublicKey(hexToBytes(OTHER_PRIVATE_KEY)) as PublicKey;

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
    replaceable_key: `34770:${draft.event.pubkey}:${draft.rootUuid}`,
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
        as_user: PUBKEY,
        synced_at: "2026-03-11T12:00:00.000Z",
        relay_urls: ["wss://relay.example/"],
        contact_pubkeys: [],
        authors: [
          {
            pubkey: PUBKEY,
            last_document_created_at: Math.max(
              ...drafts.map((draft) => draft.event.created_at)
            ),
          },
        ],
        documents,
      },
      null,
      2
    ),
    "utf8"
  );
}

test("writeSetText updates the local workspace and queues the signed event", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  const homeDraft = buildSingleRootMarkdownDocumentEvent(
    PUBKEY,
    "# Home\n\n## Plan\n"
  );
  writeWorkspace(tempDir, [homeDraft]);
  const planRelation = parseDocumentEvent(homeDraft.event)
    .valueSeq()
    .find((relation) => relation.text === "Plan");

  const result = await writeSetText(
    {
      pubkey: PUBKEY,
      workspaceDir: tempDir,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      relationId: shortID(planRelation?.id as ID) as ID,
      text: "Updated Plan",
      relayUrls: ["wss://override.example/"],
    }
  );

  const graph = await loadWorkspaceGraph(tempDir);
  const updatedRoot = graph.documentsByRootRelationId.get(homeDraft.relationID);
  const pendingEntries = await loadPendingWriteEntries(knowstrHome);

  expect(updatedRoot?.event_id).toBe(result.event_ids[0]);
  expect(result.pending_event_ids).toEqual([result.event_ids[0]]);
  expect(result.pending_count).toBe(1);
  expect(result.relay_urls).toEqual(["wss://override.example/"]);
  expect(pendingEntries[0]?.relayUrls).toEqual(["wss://override.example/"]);
  expect(
    parseDocumentEvent({
      kind: 34770,
      pubkey: PUBKEY,
      created_at: 0,
      tags: [
        ["d", homeDraft.rootUuid],
        ["ms", "0"],
      ],
      content: fs.readFileSync(
        path.join(tempDir, updatedRoot?.path || ""),
        "utf8"
      ),
    })
      .valueSeq()
      .some((relation) => relation.text === "Updated Plan")
  ).toBe(true);
});

test("writeSetText rejects editing another author's relation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  const foreignDraft = buildSingleRootMarkdownDocumentEvent(
    OTHER_PUBKEY,
    "# Foreign Home\n\n## Foreign Plan\n"
  );
  writeWorkspace(tempDir, [foreignDraft]);
  const foreignPlan = parseDocumentEvent(foreignDraft.event)
    .valueSeq()
    .find((relation) => relation.text === "Foreign Plan");

  await expect(
    writeSetText(
      {
        pubkey: PUBKEY,
        workspaceDir: tempDir,
        knowstrHome,
        relays: [{ url: "wss://write.example/", read: true, write: true }],
        nsecFile: nsecPath,
      },
      {
        relationId: foreignPlan?.id as LongID,
        text: "Should Fail",
        relayUrls: ["wss://override.example/"],
      }
    )
  ).rejects.toThrow(`Relation is not writable: ${foreignPlan?.id}`);
});

test("writeLink allows linking another author's relation into the current user's document", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  const ownDraft = buildSingleRootMarkdownDocumentEvent(
    PUBKEY,
    "# Home\n\n## Bucket\n"
  );
  const foreignDraft = buildSingleRootMarkdownDocumentEvent(
    OTHER_PUBKEY,
    "# Foreign Home\n\n## Shared Target\n"
  );
  writeWorkspace(tempDir, [ownDraft, foreignDraft]);
  const bucketRelation = parseDocumentEvent(ownDraft.event)
    .valueSeq()
    .find((relation) => relation.text === "Bucket");
  const foreignTarget = parseDocumentEvent(foreignDraft.event)
    .valueSeq()
    .find((relation) => relation.text === "Shared Target");

  const result = await writeLink(
    {
      pubkey: PUBKEY,
      workspaceDir: tempDir,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      parentRelationId: shortID(bucketRelation?.id as ID) as ID,
      targetRelationId: foreignTarget?.id as LongID,
      relayUrls: ["wss://override.example/"],
    }
  );

  const graph = await loadWorkspaceGraph(tempDir);
  const updatedRoot = graph.documentsByRootRelationId.get(ownDraft.relationID);
  const updatedContent = fs.readFileSync(
    path.join(tempDir, updatedRoot?.path || ""),
    "utf8"
  );

  expect(result.pending_count).toBe(1);
  expect(result.item_id).toMatch(/^cref:/);
  expect(updatedRoot?.event_id).toBe(result.event_ids[0]);
  expect(updatedContent).toContain(`[Shared Target](#${foreignTarget?.id})`);
});

test("writeMoveItem resolves a cref row from the target relation UUID", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  const ownDraft = buildSingleRootMarkdownDocumentEvent(
    PUBKEY,
    "# Home\n\n## Source\n\n## Target\n"
  );
  const foreignDraft = buildSingleRootMarkdownDocumentEvent(
    OTHER_PUBKEY,
    "# Foreign Home\n\n## Shared Target\n"
  );
  writeWorkspace(tempDir, [ownDraft, foreignDraft]);
  const ownRelations = parseDocumentEvent(ownDraft.event).valueSeq().toArray();
  const sourceRelation = ownRelations.find(
    (relation) => relation.text === "Source"
  );
  const targetRelation = ownRelations.find(
    (relation) => relation.text === "Target"
  );
  const foreignTarget = parseDocumentEvent(foreignDraft.event)
    .valueSeq()
    .find((relation) => relation.text === "Shared Target");

  await writeLink(
    {
      pubkey: PUBKEY,
      workspaceDir: tempDir,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      parentRelationId: shortID(sourceRelation?.id as ID) as ID,
      targetRelationId: foreignTarget?.id as LongID,
      relayUrls: ["wss://override.example/"],
    }
  );

  const result = await writeMoveItem(
    {
      pubkey: PUBKEY,
      workspaceDir: tempDir,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      sourceParentRelationId: shortID(sourceRelation?.id as ID) as ID,
      itemId: shortID(foreignTarget?.id as ID) as ID,
      targetParentRelationId: shortID(targetRelation?.id as ID) as ID,
      relayUrls: ["wss://override.example/"],
    }
  );

  const graph = await loadWorkspaceGraph(tempDir);
  const updatedRoot = graph.documentsByRootRelationId.get(ownDraft.relationID);
  const updatedContent = fs.readFileSync(
    path.join(tempDir, updatedRoot?.path || ""),
    "utf8"
  );

  expect(result.pending_count).toBe(1);
  expect(updatedContent).toMatch(
    new RegExp(
      `- Source .*\\n- Target .*\\n  - \\[Shared Target\\]\\(#${foreignTarget?.id}\\)`
    )
  );
});
