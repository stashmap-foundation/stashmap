/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { parseDocumentEvent } from "../markdownRelations";
import { buildSingleRootMarkdownDocumentEvent } from "../standaloneDocumentEvent";
import { loadPendingWriteEntries } from "./pendingWrites";
import { loadWorkspaceGraph } from "./workspaceGraph";
import { writeSetText } from "./writeWorkspace";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;

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
      relationId: planRelation?.id as LongID,
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
