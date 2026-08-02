/* eslint-disable functional/immutable-data, functional/no-let, no-console */
/**
 * Generates the shared signed-event conformance fixtures.
 *
 * The markdown corpus pins the parser; these fixtures pin the wire. They
 * are canonical kind-34774 deposits built through the production
 * `buildDepositEvent` path, signed with fixed keys at fixed timestamps,
 * for the wallet's Rust backend — the wire contract's second
 * implementation — to verify: signature validity, `d` = `knowstr_doc_id`,
 * graph-derived `S` tags, and newest-wins selection per (pubkey, docId)
 * with the `ms` tie-break.
 *
 * Usage:
 *   npx esbuild scripts/generateKnowstrEventFixtures.ts --bundle \
 *     --platform=node --outfile=/tmp/knowstr-event-gen.cjs
 *   node /tmp/knowstr-event-gen.cjs <outFile>
 */
/// <reference path="../src/types.ts" />
import * as fs from "fs";
import * as path from "path";
import { Map as ImmutableMap } from "immutable";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import {
  documentKeyOf,
  parseToDocumentPreservingExplicitIds,
  withDocumentRealWorldEntities,
} from "../src/core/Document";
import {
  buildDepositEvent,
  selectLatestDepositEvents,
} from "../src/nodesDocumentEvent";
import { LOCAL } from "../src/core/nodeRef";
import { renderDocumentMarkdown } from "../src/documentRenderer";
import { decodePublicKeyInputSync } from "../src/infra/nostr/publicKeys";

const ALICE_SK =
  "0000000000000000000000000000000000000000000000000000000000000001";
const BOB_SK =
  "0000000000000000000000000000000000000000000000000000000000000002";
const CONTRACT_ID = "rgb:l7rVx_og-lcMfB5R-C13FD57-9yo7HSq-LzKevkU-pALJ06A";

type FixtureCase = {
  name: string;
  markdown: string;
  secretKey: string;
  createdAt: number;
  ms: number;
};

const CASES: FixtureCase[] = [
  {
    name: "asset-home",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-asset-home",
      "---",
      "",
      `# Asset library <!-- id:asset:${CONTRACT_ID} -->`,
      "",
      "- Podcast <!-- id:u2 -->",
      "- Robin Dunbar <!-- id:u3 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000000,
    ms: 1750000000000,
  },
  {
    name: "entities-essay",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-entities-essay",
      "---",
      "",
      "# Travel <!-- id:u1 -->",
      "",
      "- [Barcelona](#wd:Q1492) <!-- id:u8 -->",
      "  - [Sagrada Familia](#wd:Q48435) <!-- id:u9 -->",
      "    - I want to see it <!-- id:u10 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000100,
    ms: 1750000100000,
  },
  {
    name: "arrangement",
    markdown: [
      "---",
      `knowstr_doc_id: arr:asset:${CONTRACT_ID}`,
      "knowstr_sources:",
      "  - author: npub1operator",
      "    doc: fixture-asset-home",
      "    relays:",
      "      - wss://room.example/",
      "---",
      "",
      `- [Asset library](#asset:${CONTRACT_ID}) <!-- id:a1 embed=\"true\" -->`,
      '  - (!) [Podcast](#u2) <!-- id:a2 embed="true" -->',
      "",
    ].join("\n"),
    secretKey: BOB_SK,
    createdAt: 1750000150,
    ms: 1750000150000,
  },
  {
    name: "replaceable-old",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-replaceable",
      "---",
      "",
      "# Notes <!-- id:u20 -->",
      "",
      "- old version <!-- id:u21 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000200,
    ms: 1750000200000,
  },
  {
    name: "replaceable-new",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-replaceable",
      "---",
      "",
      "# Notes <!-- id:u20 -->",
      "",
      "- new version <!-- id:u21 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000300,
    ms: 1750000300000,
  },
  {
    // Same created_at as tie-high — the ms tag must break the tie.
    name: "tie-low-ms",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-tie",
      "---",
      "",
      "# Tie <!-- id:u30 -->",
      "",
      "- earlier <!-- id:u31 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000400,
    ms: 1750000400000,
  },
  {
    name: "tie-high-ms",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-tie",
      "---",
      "",
      "# Tie <!-- id:u30 -->",
      "",
      "- later <!-- id:u31 -->",
      "",
    ].join("\n"),
    secretKey: ALICE_SK,
    createdAt: 1750000400,
    ms: 1750000400500,
  },
  {
    name: "second-author",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-replaceable",
      "---",
      "",
      "# Notes <!-- id:u20 -->",
      "",
      "- bob's version <!-- id:u21 -->",
      "",
    ].join("\n"),
    secretKey: BOB_SK,
    createdAt: 1750000250,
    ms: 1750000250000,
  },
];

function publicKey(secretKey: string): PublicKey {
  const decoded = decodePublicKeyInputSync(getPublicKey(hexToBytes(secretKey)));
  if (!decoded) {
    throw new Error("Invalid fixture public key");
  }
  return decoded;
}

function buildFixture(fixtureCase: FixtureCase) {
  const parsed = parseToDocumentPreservingExplicitIds(
    LOCAL,
    fixtureCase.markdown,
    { updatedMsOverride: fixtureCase.createdAt * 1000 }
  );
  const documents = ImmutableMap([
    [documentKeyOf(LOCAL, parsed.document.docId), parsed.document],
  ]);
  const document = withDocumentRealWorldEntities(
    parsed.context.knowledgeDBs,
    documents,
    ImmutableMap(),
    parsed.document
  );
  const content = renderDocumentMarkdown(parsed.context.knowledgeDBs, document);
  const template = buildDepositEvent(
    document,
    publicKey(fixtureCase.secretKey),
    content,
    fixtureCase.createdAt
  );
  const event = finalizeEvent(
    {
      ...template,
      tags: template.tags.map((tag) =>
        tag[0] === "ms" ? ["ms", String(fixtureCase.ms)] : tag
      ),
    },
    hexToBytes(fixtureCase.secretKey)
  );
  return {
    name: fixtureCase.name,
    secretKey: fixtureCase.secretKey,
    docId: parsed.document.docId,
    sTags: event.tags.filter((tag) => tag[0] === "S").map((tag) => tag[1]),
    event,
  };
}

async function main() {
  const outFile = process.argv[2];
  if (!outFile) {
    throw new Error("usage: node knowstr-event-gen.cjs <outFile>");
  }
  const fixtures = CASES.map(buildFixture);
  const namesById = new Map(
    fixtures.map((fixture) => [fixture.event.id, fixture.name])
  );
  const selection = selectLatestDepositEvents(
    fixtures.map((fixture) => fixture.event)
  ).map((event) => ({
    docId: event.tags.find((tag) => tag[0] === "d")?.[1] ?? "",
    winner: namesById.get(event.id) ?? "",
  }));
  const out = {
    events: fixtures,
    selection,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
