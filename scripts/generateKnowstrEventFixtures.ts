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
import { base64 } from "@scure/base";
import {
  documentKeyOf,
  parseToDocumentPreservingExplicitIds,
  withDocumentRealWorldEntities,
} from "../src/core/Document";
import { buildDepositEvent, depositEntityTags } from "../src/nodesDocumentEvent";
import { LOCAL } from "../src/core/nodeRef";
import { KIND_KNOWLEDGE_DOCUMENT } from "../src/nostr";
import { buildStorageEnvelope } from "../src/storageEncryption";

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
    name: "entities-essay",
    markdown: [
      "---",
      "knowstr_doc_id: fixture-entities-essay",
      "knowstr_publish:",
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
  const documents = ImmutableMap([
    [documentKeyOf(LOCAL, parsed.document.docId), parsed.document],
  ]);
  const document = withDocumentRealWorldEntities(
    parsed.context.knowledgeDBs,
    documents,
    ImmutableMap(),
    parsed.document
  );
  const template = buildDepositEvent(
    document,
    "" as PublicKey,
    fixtureCase.markdown,
    depositEntityTags(document)
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

// Encrypted-storage conformance (the wire, 34775): a signed storage event
// whose content is built through the production buildStorageEnvelope path
// with fixed keys. age and nip44 are randomized, so this pins the
// decrypt direction: the Rust side must open the envelope as the author
// (nip44 unwrap) and through the bare storage key (the capability path).
async function buildStorageFixture() {
  const secretKey = ALICE_SK;
  const privateKey = hexToBytes(secretKey);
  const user: KeyPair = {
    privateKey,
    publicKey: getPublicKey(privateKey) as PublicKey,
  };
  const storageKey = base64.encode(new Uint8Array(32).fill(3));
  const docId = "fixture-storage";
  const markdown = [
    "---",
    `knowstr_doc_id: ${docId}`,
    "---",
    "",
    "# Private Notes <!-- id:u40 -->",
    "",
    "- readable only through the envelope <!-- id:u41 -->",
    "",
  ].join("\n");
  const content = await buildStorageEnvelope(user, storageKey, markdown);
  const event = finalizeEvent(
    {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      created_at: 1750000500,
      tags: [
        ["d", docId],
        ["ms", "1750000500000"],
      ],
      content,
    },
    privateKey
  );
  return {
    comment:
      "Generated by knowstr scripts/generateKnowstrEventFixtures.ts — do " +
      "not edit. Ciphertext is randomized per generation; conformance is " +
      "the decrypt direction: open as the author and via the storage key.",
    secretKey,
    storageKey,
    docId,
    markdown,
    event,
  };
}

async function main() {
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

  const storageOutFile = path.join(
    path.dirname(outFile),
    "storage-envelope.json"
  );
  const storageFixture = await buildStorageFixture();
  fs.writeFileSync(
    storageOutFile,
    `${JSON.stringify(storageFixture, null, 2)}\n`
  );
  console.log(`generated storage envelope -> ${storageOutFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
