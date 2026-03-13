/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { loadPendingWriteEntries } from "./pendingWrites";
import { loadWorkspaceManifest } from "./workspaceState";
import { writeCreateRoot, WriteProfile } from "./writeCreateRoot";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;

test("writeCreateRoot queues a standalone root with explicit relay overrides", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  const profile: WriteProfile & { knowstrHome: string } = {
    pubkey: PUBKEY,
    relays: [
      { url: "wss://read-only.example/", read: true, write: false },
      { url: "wss://write.example/", read: true, write: true },
    ],
    nsecFile: nsecPath,
    knowstrHome,
  };

  const result = await writeCreateRoot(profile, {
    title: "My Root",
    relayUrls: ["wss://override.example/"],
  });
  const pendingEntries = await loadPendingWriteEntries(knowstrHome);

  expect(result.relation_id).toBe(`${PUBKEY}_${result.root_uuid}`);
  expect(result.event_id).toBe(pendingEntries[0]?.event.id);
  expect(result.pending_event_ids).toEqual([result.event_id]);
  expect(result.pending_count).toBe(1);
  expect(result.relay_urls).toEqual(["wss://override.example/"]);
  expect(pendingEntries[0]?.relayUrls).toEqual(["wss://override.example/"]);
  expect(pendingEntries[0]?.event.content).toContain("# My Root {");
});

test("writeCreateRoot can include markdown when requested", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  const result = await writeCreateRoot(
    {
      pubkey: PUBKEY,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      title: "My Root",
      includeMarkdown: true,
    }
  );

  expect(result.markdown).toContain("# My Root {");
  expect(result.markdown?.endsWith("\n")).toBe(true);
});

test("writeCreateRoot uploads markdown files using current import wrapping rules", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  const markdownPath = path.join(tempDir, "roadmap.md");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  fs.writeFileSync(markdownPath, "# Phase 1\n\n# Phase 2\n");

  const result = await writeCreateRoot(
    {
      pubkey: PUBKEY,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      filePath: markdownPath,
      includeMarkdown: true,
    }
  );

  expect(result.relation_id).toBe(`${PUBKEY}_${result.root_uuid}`);
  expect(result.markdown).toContain("# roadmap {");
  expect(result.markdown).toContain("- Phase 1 {");
  expect(result.markdown).toContain("- Phase 2 {");
});

test("writeCreateRoot uploads stdin markdown only when it has one top-level root", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  const result = await writeCreateRoot(
    {
      pubkey: PUBKEY,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      markdownText: "# Parent\n\n## Child\n",
      includeMarkdown: true,
    }
  );

  expect(result.markdown).toContain("# Parent {");
  expect(result.markdown).toContain("- Child {");
});

test("writeCreateRoot rejects stdin markdown with multiple top-level roots", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  await expect(
    writeCreateRoot(
      {
        pubkey: PUBKEY,
        relays: [{ url: "wss://write.example/", read: true, write: true }],
        nsecFile: nsecPath,
      },
      {
        markdownText: "# One\n\n# Two\n",
      }
    )
  ).rejects.toThrow(
    "stdin markdown must resolve to exactly one top-level root"
  );
});

test("writeCreateRoot updates the local workspace and queue when workspaceDir is available", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  const result = await writeCreateRoot(
    {
      pubkey: PUBKEY,
      workspaceDir: tempDir,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      title: "My Root",
    }
  );

  const manifest = await loadWorkspaceManifest(tempDir);
  const pendingEntries = await loadPendingWriteEntries(knowstrHome);

  expect(
    manifest?.documents.find(
      (document) => document.event_id === result.event_id
    )
  ).toBeDefined();
  expect(pendingEntries.map(({ event }) => event.id)).toEqual([
    result.event_id,
  ]);
});
