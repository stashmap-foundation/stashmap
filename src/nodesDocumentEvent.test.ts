import type { Document } from "./core/Document";
import { parseToDocumentPreservingExplicitIds } from "./core/Document";
import {
  parseFrontMatter,
  publishStateOf,
  serializeFrontMatter,
  withPublishState,
  withoutPublishState,
} from "./core/knowstrFrontmatter";
import {
  buildDepositEvent,
  depositEntityTags,
  depositWriteRelayConf,
} from "./nodesDocumentEvent";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

function parseDoc(markdown: string): Document {
  return parseToDocumentPreservingExplicitIds(TEST_PUBKEY, markdown, {
    docIdFallback: "doc-1",
  }).document;
}

test("publishStateOf is undefined without the key", () => {
  expect(publishStateOf(undefined)).toBeUndefined();
  expect(publishStateOf({ knowstr_doc_id: "d1" })).toBeUndefined();
});

test("the bare key is the minimal published form", () => {
  const fm = parseFrontMatter("knowstr_doc_id: d1\nknowstr_publish:\n");
  expect(publishStateOf(fm)).toEqual({ entities: [], paused: false });
});

test("publishStateOf reads entities, relays, and paused", () => {
  const fm = parseFrontMatter(
    [
      "knowstr_publish:",
      "  entities:",
      "    - asset:rgb:test-contract",
      "    - wd:Q1 wd:Q2",
      "  relays:",
      "    - wss://relay.example",
      "  paused: true",
      "",
    ].join("\n")
  );
  expect(publishStateOf(fm)).toEqual({
    entities: ["asset:rgb:test-contract", "wd:Q1 wd:Q2"],
    relays: ["wss://relay.example"],
    paused: true,
  });
});

test("publish state round-trips through frontmatter serialization", () => {
  const state = {
    entities: ["asset:rgb:test-contract"],
    relays: ["wss://relay.example"],
    paused: true,
  };
  const serialized = serializeFrontMatter(
    withPublishState({ knowstr_doc_id: "d1" }, state)
  );
  const inner = serialized.replace(/^---\n/u, "").replace(/---\n$/u, "");
  expect(publishStateOf(parseFrontMatter(inner))).toEqual(state);
});

test("withPublishState writes the bare key for the minimal form", () => {
  const fm = withPublishState(undefined, { entities: [], paused: false });
  expect("knowstr_publish" in fm).toBe(true);
  expect(publishStateOf(fm)).toEqual({ entities: [], paused: false });
});

test("withoutPublishState removes the key entirely", () => {
  const fm = withPublishState(
    { knowstr_doc_id: "d1" },
    {
      entities: ["wd:Q1"],
      paused: false,
    }
  );
  expect(publishStateOf(withoutPublishState(fm))).toBeUndefined();
  expect(withoutPublishState(fm).knowstr_doc_id).toBe("d1");
});

test("deposit S set is {own roots} ∪ entities, deduplicated", () => {
  const document = parseDoc(
    [
      "---",
      "knowstr_doc_id: doc-1",
      "knowstr_publish:",
      "  entities:",
      "    - asset:rgb:test-contract",
      "    - u77",
      "---",
      "# Essay <!-- id:u77 -->",
      "",
    ].join("\n")
  );
  expect(depositEntityTags(document)).toEqual([
    "u77",
    "asset:rgb:test-contract",
  ]);
});

test("buildDepositEvent carries kind 34774, d, S tags, and ms", () => {
  const document = parseDoc(
    [
      "---",
      "knowstr_doc_id: doc-1",
      "knowstr_publish:",
      "  entities:",
      "    - asset:rgb:test-contract",
      "---",
      "# Essay <!-- id:u77 -->",
      "",
    ].join("\n")
  );
  const event = buildDepositEvent(document, TEST_PUBKEY, "content");
  expect(event.kind).toBe(KIND_KNOWLEDGE_DEPOSIT);
  expect(event.pubkey).toBe(TEST_PUBKEY);
  expect(event.content).toBe("content");
  expect(event.tags.filter(([name]) => name === "d")).toEqual([["d", "doc-1"]]);
  expect(event.tags.filter(([name]) => name === "S")).toEqual([
    ["S", "u77"],
    ["S", "asset:rgb:test-contract"],
  ]);
  expect(event.tags.some(([name]) => name === "ms")).toBe(true);
});

test("an unpublished document's deposit tags are its roots alone", () => {
  const document = parseDoc("# Essay <!-- id:u77 -->\n");
  expect(depositEntityTags(document)).toEqual(["u77"]);
});

const PUBLISHED_UNDER_ASSET = [
  "---",
  "knowstr_doc_id: doc-1",
  "knowstr_publish:",
  "  entities:",
  "    - asset:rgb:test-contract",
  "  relays:",
  "    - wss://salon.example",
  "---",
  "# Essay <!-- id:u77 -->",
  "",
].join("\n");

const USER_RELAYS: Relays = [
  { url: "wss://mine.example", read: true, write: true },
];

test("declared relays replace the configured set; the asset scheme joins", () => {
  const document = parseDoc(PUBLISHED_UNDER_ASSET);
  expect(
    depositWriteRelayConf(document, USER_RELAYS, "wss://deedsats.example")
  ).toEqual({
    extraRelays: [
      { url: "wss://salon.example", read: false, write: true },
      { url: "wss://deedsats.example", read: false, write: true },
    ],
  });
});

test("an explicitly empty destination set persists and publishes nowhere", () => {
  const fm = withPublishState(undefined, {
    entities: [],
    relays: [],
    paused: false,
  });
  const serialized = serializeFrontMatter(fm);
  const inner = serialized.replace(/^---\n/u, "").replace(/---\n$/u, "");
  expect(publishStateOf(parseFrontMatter(inner))?.relays).toEqual([]);

  const document = parseDoc(
    [
      "---",
      "knowstr_doc_id: doc-1",
      "knowstr_publish:",
      "  relays: []",
      "---",
      "# Essay <!-- id:u77 -->",
      "",
    ].join("\n")
  );
  expect(depositWriteRelayConf(document, USER_RELAYS, undefined)).toEqual({
    extraRelays: [],
  });
});

test("without declared relays: the configured set, else the defaults", () => {
  const noDeclared = parseDoc(
    [
      "---",
      "knowstr_doc_id: doc-1",
      "knowstr_publish:",
      "  entities:",
      "    - asset:rgb:test-contract",
      "---",
      "# Essay <!-- id:u77 -->",
      "",
    ].join("\n")
  );
  expect(depositWriteRelayConf(noDeclared, USER_RELAYS, undefined)).toEqual({
    user: true,
    extraRelays: [],
  });
  expect(
    depositWriteRelayConf(noDeclared, [], "wss://deedsats.example")
  ).toEqual({
    defaultRelays: true,
    extraRelays: [{ url: "wss://deedsats.example", read: false, write: true }],
  });
});
