/* eslint-disable functional/immutable-data, functional/no-let, no-console */
/**
 * Generates the shared signed-event conformance fixtures.
 *
 * The markdown corpus pins the parser; these fixtures pin the wire. They
 * are canonical kind-34774 deposits built through the production
 * `buildDepositEvent` path, signed with fixed keys at fixed timestamps,
 * for the wallet's Rust backend — the wire contract's second
 * implementation — to verify: signature validity, `d` = `knowstr_doc_id`,
 * `S` = {roots} ∪ `knowstr_publish.entities` (bare entity tags), and
 * newest-wins selection per (pubkey, docId) with the `ms` tie-break.
 *
 * Usage:
 *   npx esbuild scripts/generateKnowstrEventFixtures.ts --bundle \
 *     --platform=node --outfile=/tmp/knowstr-event-gen.cjs
 *   node /tmp/knowstr-event-gen.cjs <outFile>
 */
/// <reference path="../src/types.ts" />
import * as fs from "fs";
import * as path from "path";
import { finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { parseToDocumentPreservingExplicitIds } from "../src/core/Document";
import { buildDepositEvent } from "../src/nodesDocumentEvent";
import { LOCAL } from "../src/core/nodeRef";

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
    // The entity home: the document root IS the asset entity node.
    name: "asset-home",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-asset-home",
      "knowstr_publish:",
      "  entities: []",
      "---",
      "",
      `# ${CONTRACT_ID} <!-- id:asset:${CONTRACT_ID} -->`,
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
    // Bare entity tags recorded in knowstr_publish.entities.
    name: "entities-essay",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-entities-essay",
      "knowstr_publish:",
      "  entities:",
      "    - wd:Q1492",
      "    - wd:Q48435",
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
    name: "replaceable-old",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-replaceable",
      "knowstr_publish:",
      "  entities: []",
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
      "knowstr_publish:",
      "  entities: []",
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
      "knowstr_publish:",
      "  entities: []",
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
      "knowstr_publish:",
      "  entities: []",
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
    // Another author on the same docId: deposits key per (pubkey, docId),
    // nothing merges by pubkey.
    name: "second-author",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-replaceable",
      "knowstr_publish:",
      "  entities: []",
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

function buildFixture(fixtureCase: FixtureCase) {
  const parsed = parseToDocumentPreservingExplicitIds(
    LOCAL,
    fixtureCase.markdown,
    {}
  );
  const template = buildDepositEvent(
    parsed.document,
    "" as PublicKey,
    fixtureCase.markdown
  );
  const withFixedTime = {
    ...template,
    created_at: fixtureCase.createdAt,
    tags: template.tags.map((tag) =>
      tag[0] === "ms" ? ["ms", String(fixtureCase.ms)] : tag
    ),
  };
  const { pubkey: _drop, ...unsigned } = withFixedTime;
  const event = finalizeEvent(unsigned, hexToBytes(fixtureCase.secretKey));
  return {
    name: fixtureCase.name,
    docId: parsed.document.docId,
    sTags: withFixedTime.tags
      .filter((tag) => tag[0] === "S")
      .map((tag) => tag[1]),
    event,
  };
}

function main() {
  const outFile = process.argv[2];
  if (!outFile) {
    console.error("usage: node knowstr-event-gen.cjs <outFile>");
    process.exit(1);
  }
  const fixtures = CASES.map(buildFixture);
  const selection = [
    { docId: "fixture-asset-home", winner: "asset-home" },
    { docId: "fixture-entities-essay", winner: "entities-essay" },
    { docId: "fixture-replaceable", winner: "replaceable-new" },
    { docId: "fixture-replaceable", winner: "second-author" },
    { docId: "fixture-tie", winner: "tie-high-ms" },
  ];
  const out = {
    comment:
      "Generated by knowstr scripts/generateKnowstrEventFixtures.ts — do not edit. " +
      "Selection lists one winner per (author, docId).",
    events: fixtures,
    selection,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`generated ${fixtures.length} events -> ${outFile}`);
}

main();
