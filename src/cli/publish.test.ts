/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { Event, Relay, UnsignedEvent, nip19, verifyEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { KIND_KNOWLEDGE_DEPOSIT } from "../nostr";
import { PUBLISH_TIMEOUT } from "../infra/nostr/nostrPublish";
import {
  knowstrInit,
  knowstrPublish,
  readNodeId,
  write,
} from "../testFixtures/workspace";
import { runInitCommand } from "./init";

const ROOM = "wss://room.example/";
const MIRROR = "wss://mirror.example/";

const stderr = jest.spyOn(process.stderr, "write");

beforeEach(() => {
  stderr.mockImplementation(() => true);
});

afterAll(() => {
  stderr.mockRestore();
});

function progress(): string[] {
  return stderr.mock.calls
    .map(([chunk]) => String(chunk).trimEnd())
    .filter((line) => !line.startsWith("(node:"));
}

function recordingPool({
  answer = () => Promise.resolve(""),
  unreachable = [],
}: {
  answer?: (relayUrl: string, event: Event) => Promise<string>;
  unreachable?: string[];
} = {}): {
  pool: { ensureRelay: jest.Mock; publish: jest.Mock; close: jest.Mock };
  ensureRelay: jest.Mock<Promise<Relay>, [string]>;
  publish: jest.Mock<Promise<string>[], [string[], Event]>;
  close: jest.Mock<void, [string[]]>;
} {
  const ensureRelay = jest.fn<Promise<Relay>, [string]>((relayUrl) =>
    unreachable.includes(relayUrl)
      ? Promise.reject(new Error("connection timed out"))
      : Promise.resolve(new Relay(relayUrl))
  );
  const publish = jest.fn<Promise<string>[], [string[], Event]>(
    (relayUrls, event) => relayUrls.map((relayUrl) => answer(relayUrl, event))
  );
  const close = jest.fn<void, [string[]]>();
  return {
    pool: { ensureRelay, publish, close },
    ensureRelay,
    publish,
    close,
  };
}

function rejecting(
  relayUrl: string,
  reason: string = "blocked"
): (candidate: string) => Promise<string> {
  return (candidate) =>
    candidate === relayUrl
      ? Promise.reject(new Error(reason))
      : Promise.resolve("");
}

function readFile(workspaceDir: string, relativePath: string): string {
  return fs.readFileSync(path.join(workspaceDir, relativePath), "utf8");
}

function readDocId(workspaceDir: string, relativePath: string): string {
  const match = readFile(workspaceDir, relativePath).match(
    /^---\nknowstr_doc_id: (\S+)\n/u
  );
  if (!match?.[1]) {
    throw new Error(`readDocId: no knowstr_doc_id in ${relativePath}`);
  }
  return match[1];
}

function readPublished(workspaceDir: string): unknown {
  return JSON.parse(readFile(workspaceDir, ".knowstr/published.json"));
}

function fingerprintOf(event: UnsignedEvent): string {
  return bytesToHex(
    sha256(
      JSON.stringify([
        event.kind,
        event.pubkey,
        event.tags.filter((tag) => tag[0] !== "ms"),
        event.content,
      ])
    )
  );
}

function sTags(event: Event): string[] {
  return event.tags.filter((tag) => tag[0] === "S").map((tag) => tag[1]);
}

function publishedEvents(
  publish: jest.Mock<Promise<string>[], [string[], Event]>
): Array<{ relayUrls: string[]; event: Event }> {
  return publish.mock.calls.map(([relayUrls, event]) => ({
    relayUrls,
    event,
  }));
}

async function until(condition: () => boolean): Promise<void> {
  if (condition()) {
    return;
  }
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await until(condition);
}

test("publish saves, signs one deposit per document, and records each relay that accepted it", async () => {
  const { path: workspaceDir, npub } = knowstrInit({
    relays: [ROOM, MIRROR],
  });
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  write(workspaceDir, "notes/b.md", "# Beta\n- two\n");
  write(workspaceDir, ".gitignore", "notes/\n");
  const { pool, ensureRelay, publish, close } = recordingPool({
    answer: rejecting(MIRROR),
  });

  const result = await knowstrPublish(workspaceDir, pool);
  const room = await ensureRelay.mock.results[0].value;
  room.onnotice("slow down");

  const paths = [
    path.join(workspaceDir, "a.md"),
    path.join(workspaceDir, "notes/b.md"),
  ];
  expect(result).toEqual({
    changed_paths: paths,
    accepted_paths: paths,
    unaccepted_paths: [],
    rejections: paths.map((docPath) => ({
      path: docPath,
      relay: MIRROR,
      reason: "blocked",
    })),
    warnings: [],
  });
  expect(ensureRelay.mock.calls).toEqual([[ROOM], [MIRROR]]);
  expect(progress()).toEqual([
    "Saved 2 documents. Publishing 2 to 2 relays, 0 unchanged, 0 with warnings.",
    `[1/2] a.md  1/2 relays  ${MIRROR}: blocked`,
    `[2/2] notes/b.md  1/2 relays  ${MIRROR}: blocked`,
    "Published 2 documents. Relay rejections: 2 (retried on the next run).",
    `${ROOM}: slow down`,
  ]);
  const events = publishedEvents(publish);
  expect(events.map(({ relayUrls }) => relayUrls)).toEqual([
    [ROOM, MIRROR],
    [ROOM, MIRROR],
  ]);
  events.forEach(({ event }) => {
    expect(verifyEvent(event)).toBe(true);
    expect(event.kind).toBe(KIND_KNOWLEDGE_DEPOSIT);
    expect(event.pubkey).toBe(nip19.decode(npub).data);
  });
  expect(events[0].event.content).toBe(readFile(workspaceDir, "a.md"));
  expect(events[1].event.content).toBe(readFile(workspaceDir, "notes/b.md"));
  expect(events[0].event.tags).toContainEqual([
    "d",
    readDocId(workspaceDir, "a.md"),
  ]);
  expect(sTags(events[0].event)).toEqual([
    readNodeId(workspaceDir, "a.md", "# Alpha"),
  ]);
  expect(readPublished(workspaceDir)).toEqual({
    [ROOM]: {
      [readDocId(workspaceDir, "a.md")]: fingerprintOf(events[0].event),
      [readDocId(workspaceDir, "notes/b.md")]: fingerprintOf(events[1].event),
    },
  });
  expect(close).toHaveBeenCalledWith([ROOM, MIRROR]);
});

test("publish retries only the relays that did not accept a document", async () => {
  const { path: workspaceDir } = knowstrInit({ relays: [ROOM, MIRROR] });
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  write(workspaceDir, "b.md", "# Beta\n- two\n");
  await knowstrPublish(
    workspaceDir,
    recordingPool({ answer: rejecting(MIRROR) }).pool
  );

  const second = recordingPool();
  const result = await knowstrPublish(workspaceDir, second.pool);

  expect(result.changed_paths).toEqual([]);
  expect(result.accepted_paths).toEqual([
    path.join(workspaceDir, "a.md"),
    path.join(workspaceDir, "b.md"),
  ]);
  expect(result.rejections).toEqual([]);
  const events = publishedEvents(second.publish);
  expect(events.map(({ relayUrls }) => relayUrls)).toEqual([
    [MIRROR],
    [MIRROR],
  ]);
  const fingerprints = {
    [readDocId(workspaceDir, "a.md")]: fingerprintOf(events[0].event),
    [readDocId(workspaceDir, "b.md")]: fingerprintOf(events[1].event),
  };
  expect(readPublished(workspaceDir)).toEqual({
    [ROOM]: fingerprints,
    [MIRROR]: fingerprints,
  });

  stderr.mockClear();
  const offline = recordingPool({ unreachable: [ROOM, MIRROR] });
  expect(await knowstrPublish(workspaceDir, offline.pool)).toEqual({
    changed_paths: [],
    accepted_paths: [],
    unaccepted_paths: [],
    rejections: [],
    warnings: [],
  });
  expect(progress()).toEqual([
    "Saved 2 documents. Publishing 0 to 2 relays, 2 unchanged, 0 with warnings.",
    "Published 0 documents.",
  ]);
  expect(offline.ensureRelay).not.toHaveBeenCalled();
  expect(offline.publish).not.toHaveBeenCalled();
  expect(offline.close).not.toHaveBeenCalled();
});

test("publish keeps a document held by one relay when the other keeps rejecting it", async () => {
  const { path: workspaceDir } = knowstrInit({ relays: [ROOM, MIRROR] });
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  await knowstrPublish(
    workspaceDir,
    recordingPool({ answer: rejecting(MIRROR) }).pool
  );

  stderr.mockClear();
  const again = recordingPool({ answer: rejecting(MIRROR) });
  const result = await knowstrPublish(workspaceDir, again.pool);

  expect(result).toEqual({
    changed_paths: [],
    accepted_paths: [],
    unaccepted_paths: [],
    rejections: [
      {
        path: path.join(workspaceDir, "a.md"),
        relay: MIRROR,
        reason: "blocked",
      },
    ],
    warnings: [],
  });
  expect(
    publishedEvents(again.publish).map(({ relayUrls }) => relayUrls)
  ).toEqual([[MIRROR]]);
  expect(progress()).toEqual([
    "Saved 1 documents. Publishing 1 to 2 relays, 0 unchanged, 0 with warnings.",
    `[1/1] a.md  0/1 relays  ${MIRROR}: blocked`,
    "Published 0 of 1 documents. Relay rejections: 1 (retried on the next run).",
  ]);
});

test("publish backfills a relay added after the first publication", async () => {
  const { path: workspaceDir } = knowstrInit({ relays: [ROOM] });
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  await knowstrPublish(workspaceDir, recordingPool().pool);
  write(
    workspaceDir,
    ".knowstr/profile.json",
    JSON.stringify({
      nsec_file: "./.knowstr/me.nsec",
      shared: { relays: [ROOM, MIRROR] },
    })
  );

  const { pool, publish } = recordingPool();
  const result = await knowstrPublish(workspaceDir, pool);

  expect(result.accepted_paths).toEqual([path.join(workspaceDir, "a.md")]);
  expect(publishedEvents(publish).map(({ relayUrls }) => relayUrls)).toEqual([
    [MIRROR],
  ]);
});

test("publish republishes a document whose tags change without its bytes changing", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "a.md",
    "# Alpha <!-- id:a -->\n- [see x](#x) <!-- id:a1 -->\n"
  );
  write(workspaceDir, "b.md", "# Beta <!-- id:b -->\n- x <!-- id:x -->\n");
  write(workspaceDir, "c.md", "# Gamma <!-- id:c -->\n");
  const first = recordingPool();
  await knowstrPublish(workspaceDir, first.pool);
  expect(sTags(publishedEvents(first.publish)[0].event)).toEqual(["a", "b"]);
  const alpha = readFile(workspaceDir, "a.md");

  write(workspaceDir, "b.md", "# Beta <!-- id:b -->\n");
  write(workspaceDir, "c.md", "# Gamma <!-- id:c -->\n- x <!-- id:x -->\n");
  const second = recordingPool();
  const result = await knowstrPublish(workspaceDir, second.pool);

  expect(readFile(workspaceDir, "a.md")).toBe(alpha);
  expect(result.accepted_paths).toEqual([
    path.join(workspaceDir, "a.md"),
    path.join(workspaceDir, "b.md"),
    path.join(workspaceDir, "c.md"),
  ]);
  const republished = publishedEvents(second.publish)[0].event;
  expect(republished.content).toBe(alpha);
  expect(sTags(republished)).toEqual(["a", "c"]);
});

test("publish leaves documents with save warnings unpublished", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  write(
    workspaceDir,
    "arrangement.md",
    [
      "---",
      "knowstr_doc_id: arr:source",
      "---",
      '- [Wrong](#other) <!-- id:a1 embed="true" -->',
      "",
    ].join("\n")
  );
  const { pool, publish } = recordingPool();

  const result = await knowstrPublish(workspaceDir, pool);

  expect(result.warnings).toEqual([
    "arrangement.md: arr:source must have one root embedding source",
  ]);
  expect(result.accepted_paths).toEqual([path.join(workspaceDir, "a.md")]);
  expect(progress()[0]).toBe(
    "Saved 2 documents. Publishing 1 to 1 relays, 0 unchanged, 1 with warnings."
  );
  expect(publishedEvents(publish).map(({ event }) => event.content)).toEqual([
    readFile(workspaceDir, "a.md"),
  ]);
  expect(readPublished(workspaceDir)).toEqual({
    [ROOM]: { [readDocId(workspaceDir, "a.md")]: expect.any(String) },
  });
});

test("publish leaves out a relay it cannot reach for this run", async () => {
  const { path: workspaceDir } = knowstrInit({ relays: [ROOM, MIRROR] });
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  write(workspaceDir, "b.md", "# Beta\n- two\n");
  write(workspaceDir, "c.md", "# Gamma\n- three\n");
  const first = recordingPool({ unreachable: [MIRROR] });

  const result = await knowstrPublish(workspaceDir, first.pool);

  const paths = ["a.md", "b.md", "c.md"].map((name) =>
    path.join(workspaceDir, name)
  );
  expect(
    publishedEvents(first.publish).map(({ relayUrls }) => relayUrls)
  ).toEqual([[ROOM], [ROOM], [ROOM]]);
  expect(result.accepted_paths).toEqual(paths);
  expect(result.unaccepted_paths).toEqual([]);
  expect(result.rejections).toEqual(
    paths.map((docPath) => ({
      path: docPath,
      relay: MIRROR,
      reason: "connection timed out",
    }))
  );
  expect(progress()).toEqual([
    "Saved 3 documents. Publishing 3 to 2 relays, 0 unchanged, 0 with warnings.",
    `${MIRROR}: connection timed out. Leaving it out for this run.`,
    `[1/3] a.md  1/2 relays  ${MIRROR}: connection timed out`,
    `[2/3] b.md  1/2 relays  ${MIRROR}: connection timed out`,
    `[3/3] c.md  1/2 relays  ${MIRROR}: connection timed out`,
    "Published 3 documents. Relay rejections: 3 (retried on the next run).",
  ]);
  expect(Object.keys(readPublished(workspaceDir) ?? {})).toEqual([ROOM]);
  expect(first.close).toHaveBeenCalledWith([ROOM, MIRROR]);

  fs.appendFileSync(path.join(workspaceDir, "a.md"), "- four\n");
  stderr.mockClear();
  const second = recordingPool();
  const again = await knowstrPublish(workspaceDir, second.pool);

  expect(again.accepted_paths).toEqual(paths);
  expect(
    publishedEvents(second.publish).map(({ relayUrls }) => relayUrls)
  ).toEqual([[ROOM, MIRROR], [MIRROR], [MIRROR]]);
  expect(progress()).toEqual([
    "Saved 3 documents. Publishing 3 to 2 relays, 0 unchanged, 0 with warnings.",
    "[1/3] a.md  2/2 relays",
    "[2/3] b.md  1/1 relays",
    "[3/3] c.md  1/1 relays",
    "Published 3 documents.",
  ]);

  fs.appendFileSync(path.join(workspaceDir, "a.md"), "- five\n");
  stderr.mockClear();
  const none = recordingPool({ unreachable: [ROOM, MIRROR] });
  const nowhere = await knowstrPublish(workspaceDir, none.pool);

  expect(nowhere.accepted_paths).toEqual([]);
  expect(nowhere.unaccepted_paths).toEqual([paths[0]]);
  expect(nowhere.rejections).toEqual([
    { path: paths[0], relay: ROOM, reason: "connection timed out" },
    { path: paths[0], relay: MIRROR, reason: "connection timed out" },
  ]);
  expect(progress()).toEqual([
    "Saved 3 documents. Publishing 1 to 2 relays, 2 unchanged, 0 with warnings.",
    `${ROOM}: connection timed out. Leaving it out for this run.`,
    `${MIRROR}: connection timed out. Leaving it out for this run.`,
    `[1/1] a.md  0/2 relays  ${ROOM}: connection timed out  ${MIRROR}: connection timed out`,
    "Published 0 of 1 documents. Relay rejections: 2 (retried on the next run).",
  ]);
  expect(none.publish).not.toHaveBeenCalled();
  expect(none.close).toHaveBeenCalledWith([ROOM, MIRROR]);
});

test("publish leaves out a relay that stops answering for the rest of the run", async () => {
  jest.useFakeTimers({
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
  });
  try {
    const { path: workspaceDir } = knowstrInit({ relays: [ROOM, MIRROR] });
    write(workspaceDir, "a.md", "# Alpha\n- one\n");
    write(workspaceDir, "b.md", "# Beta\n- two\n");
    write(workspaceDir, "c.md", "# Gamma\n- three\n");
    const { pool, publish } = recordingPool({
      answer: (relayUrl) =>
        relayUrl === MIRROR ? new Promise(() => {}) : Promise.resolve(""),
    });

    const run = knowstrPublish(workspaceDir, pool);
    await until(() => publish.mock.calls.length > 0);
    await until(() => progress().length > 0);
    expect(publish).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(PUBLISH_TIMEOUT);
    const result = await run;

    const paths = ["a.md", "b.md", "c.md"].map((name) =>
      path.join(workspaceDir, name)
    );
    expect(publishedEvents(publish).map(({ relayUrls }) => relayUrls)).toEqual([
      [ROOM, MIRROR],
      [ROOM],
      [ROOM],
    ]);
    expect(result.accepted_paths).toEqual(paths);
    expect(result.unaccepted_paths).toEqual([]);
    expect(result.rejections).toEqual(
      paths.map((docPath) => ({
        path: docPath,
        relay: MIRROR,
        reason: "Timeout",
      }))
    );
    expect(progress()).toEqual([
      "Saved 3 documents. Publishing 3 to 2 relays, 0 unchanged, 0 with warnings.",
      `[1/3] a.md  1/2 relays  ${MIRROR}: Timeout`,
      `${MIRROR} timed out, leaving it out for the rest of this run.`,
      `[2/3] b.md  1/2 relays  ${MIRROR}: Timeout`,
      `[3/3] c.md  1/2 relays  ${MIRROR}: Timeout`,
      "Published 3 documents. Relay rejections: 3 (retried on the next run).",
    ]);
  } finally {
    jest.useRealTimers();
  }
});

test("publish continues past a document no relay accepts and reports it", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "a.md", "# Alpha\n- one\n");
  write(workspaceDir, "b.md", "# Beta\n- two\n");
  write(workspaceDir, "c.md", "# Gamma\n- three\n");
  const { pool, publish, close } = recordingPool({
    answer: (_, event) =>
      event.content.includes("# Beta")
        ? Promise.reject(new Error("too large"))
        : Promise.resolve(""),
  });

  const result = await knowstrPublish(workspaceDir, pool);

  expect(result.accepted_paths).toEqual([
    path.join(workspaceDir, "a.md"),
    path.join(workspaceDir, "c.md"),
  ]);
  expect(result.unaccepted_paths).toEqual([path.join(workspaceDir, "b.md")]);
  expect(result.rejections).toEqual([
    { path: path.join(workspaceDir, "b.md"), relay: ROOM, reason: "too large" },
  ]);
  expect(publish).toHaveBeenCalledTimes(3);
  expect(progress()).toEqual([
    "Saved 3 documents. Publishing 3 to 1 relays, 0 unchanged, 0 with warnings.",
    "[1/3] a.md  1/1 relays",
    `[2/3] b.md  0/1 relays  ${ROOM}: too large`,
    "[3/3] c.md  1/1 relays",
    "Published 2 of 3 documents. Relay rejections: 1 (retried on the next run).",
  ]);
  expect(readPublished(workspaceDir)).toEqual({
    [ROOM]: {
      [readDocId(workspaceDir, "a.md")]: expect.any(String),
      [readDocId(workspaceDir, "c.md")]: expect.any(String),
    },
  });
  expect(close).toHaveBeenCalledWith([ROOM]);
});

test("publish needs a shared workspace", async () => {
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowstr-publish-")
  );
  runInitCommand([], workspaceDir);
  write(workspaceDir, "doc.md", "# Doc\n- one\n");
  const { pool, publish } = recordingPool();

  await expect(knowstrPublish(workspaceDir, pool)).rejects.toThrow(
    "Publishing needs a shared workspace: run knowstr init --shared"
  );
  expect(publish).not.toHaveBeenCalled();
});
