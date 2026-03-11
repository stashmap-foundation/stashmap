/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { Map } from "immutable";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { writeCreateRoot, WriteProfile } from "./writeCreateRoot";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;

test("writeCreateRoot publishes a standalone root to write-enabled relays", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  const profile: WriteProfile = {
    pubkey: PUBKEY,
    relays: [
      { url: "wss://read-only.example/", read: true, write: false },
      { url: "wss://write.example/", read: true, write: true },
    ],
    nsecFile: nsecPath,
  };
  const publishEvent = jest.fn((relayUrls, event) =>
    Promise.resolve({
      event,
      results: Map<string, PublishStatus>().set("wss://write.example/", {
        status: "fulfilled",
      }),
    })
  );

  const result = await writeCreateRoot(
    {
      publishEvent,
    },
    profile,
    {
      title: "My Root",
    }
  );
  const [[publishedRelays, publishedEvent]] = publishEvent.mock.calls;

  expect(publishedRelays).toEqual(["wss://write.example/"]);
  expect(result.relation_id).toBe(`${PUBKEY}_${result.root_uuid}`);
  expect(result.event_id).toBe(publishedEvent?.id);
  expect(result.publish_results).toEqual({
    "wss://write.example/": {
      status: "fulfilled",
    },
  });
  expect(result.markdown).toBeUndefined();
  expect(publishedEvent?.content).toContain("# My Root {");
  expect(publishedEvent?.pubkey).toBe(PUBKEY);
  expect(publishedEvent?.tags).toEqual(
    expect.arrayContaining([
      ["d", result.root_uuid],
      ["r", result.root_uuid],
    ])
  );
});

test("writeCreateRoot can include markdown when requested", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-write-"));
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);
  const publishEvent = jest.fn((_relayUrls, event) =>
    Promise.resolve({
      event,
      results: Map<string, PublishStatus>().set("wss://write.example/", {
        status: "fulfilled",
      }),
    })
  );

  const result = await writeCreateRoot(
    {
      publishEvent,
    },
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
  const publishEvent = jest.fn((_relayUrls, event) =>
    Promise.resolve({
      event,
      results: Map<string, PublishStatus>().set("wss://write.example/", {
        status: "fulfilled",
      }),
    })
  );

  const result = await writeCreateRoot(
    {
      publishEvent,
    },
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
  const publishEvent = jest.fn((_relayUrls, event) =>
    Promise.resolve({
      event,
      results: Map<string, PublishStatus>().set("wss://write.example/", {
        status: "fulfilled",
      }),
    })
  );

  const result = await writeCreateRoot(
    {
      publishEvent,
    },
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
        publishEvent: (_relayUrls, event) =>
          Promise.resolve({
            event,
            results: Map<string, PublishStatus>().set("wss://write.example/", {
              status: "fulfilled",
            }),
          }),
      },
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
