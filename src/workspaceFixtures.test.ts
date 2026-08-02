/** @jest-environment node */

import fs from "fs";
import path from "path";
import { Map as ImmutableMap } from "immutable";
import { Event, finalizeEvent, validateEvent, verifyEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "./testFixtures/workspace";
import {
  documentKeyOf,
  parseToDocumentPreservingExplicitIds,
  withDocumentRealWorldEntities,
} from "./core/Document";
import { LOCAL } from "./core/nodeRef";
import {
  buildDepositEvent,
  selectLatestDepositEvents,
} from "./nodesDocumentEvent";
import { loadCliProfile } from "./cli/config";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";
import { loadWorkspaceAsDocuments } from "./infra/filesystem/workspaceBackend";

test("knowstrInit creates a temp workspace with a fresh identity", () => {
  const { nsec, npub, path: workspaceDir, profilePath } = knowstrInit();

  expect(nsec).toMatch(/^nsec1/u);
  expect(npub).toMatch(/^npub1/u);
  expect(fs.existsSync(profilePath)).toBe(true);
  expect(profilePath).toBe(path.join(workspaceDir, ".knowstr", "profile.json"));
  expect(fs.existsSync(path.join(workspaceDir, ".knowstr", "me.nsec"))).toBe(
    true
  );
});

test("knowstrInit + write + knowstrSave assigns ids and normalizes markdown", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "hello.md",
    `
# Holiday Destinations
- Spain
- France
`
  );

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "hello.md")]);

  await expectMarkdown(
    workspaceDir,
    "hello.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixtureEvent(value: unknown): Event {
  if (!isRecord(value)) {
    throw new Error("Invalid signed event fixture");
  }
  const { id, sig } = value;
  if (
    !validateEvent(value) ||
    typeof id !== "string" ||
    typeof sig !== "string"
  ) {
    throw new Error("Invalid signed event fixture");
  }
  return { ...value, id, sig };
}

function fixtureCorpus(): Record<string, unknown> {
  const corpusPath = path.resolve(
    __dirname,
    "../../deedsats-wallet/packages/knowstr_core/test/corpus/events/deposits.json"
  );
  const parsed: unknown = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Invalid deposit fixture corpus");
  }
  return parsed;
}

function fixtureRecords(): Array<Record<string, unknown>> {
  const { events } = fixtureCorpus();
  if (!Array.isArray(events)) {
    throw new Error("Invalid deposit fixture cases");
  }
  return events.map((fixture) => {
    if (!isRecord(fixture)) {
      throw new Error("Invalid deposit fixture case");
    }
    return fixture;
  });
}

const signedDepositFixtures = fixtureRecords();

signedDepositFixtures.forEach((fixture) => {
  const { name } = fixture;
  if (typeof name !== "string") {
    throw new Error("Deposit fixture name is missing");
  }
  test(`signed deposit fixture: ${name}`, () => {
    const event = fixtureEvent(fixture.event);
    if (typeof fixture.secretKey !== "string") {
      throw new Error(`${name}: secret key is missing`);
    }
    const parsed = parseToDocumentPreservingExplicitIds(LOCAL, event.content, {
      updatedMsOverride: 0,
    });
    const documents = ImmutableMap([
      [documentKeyOf(LOCAL, parsed.document.docId), parsed.document],
    ]);
    const document = withDocumentRealWorldEntities(
      parsed.context.knowledgeDBs,
      documents,
      ImmutableMap(),
      parsed.document
    );
    const pubkey = decodePublicKeyInputSync(event.pubkey);
    if (!pubkey) {
      throw new Error(`${name}: pubkey is invalid`);
    }
    const rebuilt = finalizeEvent(
      buildDepositEvent(document, pubkey, event.content, event.created_at),
      hexToBytes(fixture.secretKey)
    );
    expect({
      kind: rebuilt.kind,
      pubkey: rebuilt.pubkey,
      created_at: rebuilt.created_at,
      tags: rebuilt.tags,
      content: rebuilt.content,
      id: rebuilt.id,
    }).toEqual({
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
      id: event.id,
    });
    expect(rebuilt.sig).toHaveLength(event.sig.length);
    expect(verifyEvent(event)).toBe(true);
  });
});

test("deposit construction derives every ordered S tag from the workspace graph", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "source.md",
    "# Source <!-- id: -->\n- Target <!-- id:target -->\n"
  );
  write(
    workspaceDir,
    "main.md",
    [
      "---",
      "knowstr_doc_id: multi-root",
      "---",
      "",
      "# First <!-- id:a-root -->",
      "",
      "- See [target](#target) and [asset](#asset:contract) <!-- id:links -->",
      "- [Target](#target) <!-- id:block -->",
      '- [Target](#target) <!-- id:embed embed="true" -->',
      '- My target ~~[Target](#target)~~ <!-- id:reword embed="true" -->',
      '- [feed](feed:https://example.com/feed) <!-- id:feed embed="true" -->',
      "- [web](https://example.com/) <!-- id:web -->",
      "",
      "# Second <!-- id:😀 -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspaceDir);
  const profile = loadCliProfile({ cwd: workspaceDir });
  if (!profile.pubkey) {
    throw new Error("Missing test workspace pubkey");
  }
  const documents = await loadWorkspaceAsDocuments({ workspaceDir });
  const document = documents.find(
    (candidate) => candidate.docId === "multi-root"
  );
  if (!document) {
    throw new Error("Missing multi-root fixture document");
  }
  const content = fs.readFileSync(path.join(workspaceDir, "main.md"), "utf8");
  const event = buildDepositEvent(document, profile.pubkey, content, 1234);

  expect(event).toEqual({
    kind: 34774,
    pubkey: profile.pubkey,
    created_at: 1234,
    tags: [
      ["d", "multi-root"],
      ["S", "a-root"],
      ["S", "asset:contract"],
      ["S", ""],
      ["S", "😀"],
    ],
    content,
  });
});

test("replacement ordering chooses the latest timestamp then lower id", () => {
  const base = fixtureEvent(signedDepositFixtures[0]?.event);
  const older = {
    ...base,
    id: "0".repeat(64),
    created_at: 99,
    tags: [["d", "replacement"]],
  };
  const higherId = {
    ...base,
    id: "e".repeat(64),
    created_at: 100,
    tags: [["d", "replacement"]],
  };
  const lowerId = {
    ...base,
    id: "a".repeat(64),
    created_at: 100,
    tags: [["d", "replacement"]],
  };

  expect(selectLatestDepositEvents([older, higherId, lowerId])).toEqual([
    lowerId,
  ]);
});

test("signed deposit fixture selection uses production replacement ordering", () => {
  const events = signedDepositFixtures.map((fixture) =>
    fixtureEvent(fixture.event)
  );
  const selected = selectLatestDepositEvents(events);
  const { selection } = fixtureCorpus();
  if (!Array.isArray(selection)) {
    throw new Error("Invalid deposit fixture selection");
  }
  const winnerNames = selection.map((entry) => {
    if (!isRecord(entry) || typeof entry.winner !== "string") {
      throw new Error("Invalid deposit fixture winner");
    }
    return entry.winner;
  });
  const namesById = new Map(
    signedDepositFixtures.map((fixture) => {
      if (typeof fixture.name !== "string") {
        throw new Error("Invalid fixture name");
      }
      return [fixtureEvent(fixture.event).id, fixture.name];
    })
  );

  expect(selected.map((event) => namesById.get(event.id))).toEqual(winnerNames);
});
