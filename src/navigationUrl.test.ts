import { List, Map } from "immutable";
import { shortID } from "./graph/context";
import { newDB } from "./knowledge";
import { newNode } from "./nodeFactory";
import {
  buildNodeUrl,
  pathToStack,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";

const ALICE_PK = "alice-pub-key" as PublicKey;
const OTHER_PK = "other-author" as PublicKey;

function knowledgeDBWithTexts(
  author: PublicKey,
  texts: string[]
): KnowledgeDBs {
  const nodes = texts.reduce((acc, text) => {
    const node = newNode(text, List<ID>(), author);
    return acc.set(shortID(node.id), node);
  }, Map<string, GraphNode>());
  const db: KnowledgeData = {
    ...newDB(),
    nodes,
  };
  return Map<PublicKey, KnowledgeData>({ [author]: db });
}

test("buildNodeUrl and pathToStack round-trip preserves node IDs", () => {
  const knowledgeDBs = knowledgeDBWithTexts(ALICE_PK, [
    "Holiday Destinations",
    "Barcelona",
  ]);
  const stack = ["Holiday Destinations", "Barcelona"] as ID[];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK);
  expect(path).toBe("/n/Holiday%20Destinations/Barcelona");
  expect(pathToStack(path as string)).toEqual(stack);
});

test("buildNodeUrl returns undefined when node text cannot be resolved", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  const stack = ["Some Node"] as ID[];

  const path = buildNodeUrl(stack, emptyDBs, ALICE_PK);
  expect(path).toBeUndefined();
});

test("buildNodeUrl with empty stack returns /", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  expect(buildNodeUrl([], emptyDBs, ALICE_PK)).toBe("/");
});

test("buildNodeUrl includes author param for other user", () => {
  const knowledgeDBs = knowledgeDBWithTexts(OTHER_PK, ["My Notes"]);
  const stack = ["My Notes"] as ID[];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK, OTHER_PK);
  expect(path).toBe("/n/My%20Notes?author=other-author");
});

test("buildNodeUrl omits author param for own content", () => {
  const knowledgeDBs = knowledgeDBWithTexts(ALICE_PK, ["My Notes"]);
  const stack = ["My Notes"] as ID[];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK, ALICE_PK);
  expect(path).toBe("/n/My%20Notes");
});

test("pathToStack with non /n/ path returns empty array", () => {
  expect(pathToStack("/")).toEqual([]);
  expect(pathToStack("/profile")).toEqual([]);
  expect(pathToStack("/n/")).toEqual([]);
});

test("parseNodeRouteUrl extracts node ID", () => {
  expect(parseNodeRouteUrl("/r/some-node-id")).toBe("some-node-id");
  expect(parseNodeRouteUrl("/r/encoded%2Fid")).toBe("encoded/id");
  expect(parseNodeRouteUrl("/n/something")).toBeUndefined();
  expect(parseNodeRouteUrl("/")).toBeUndefined();
});

test("parseAuthorFromSearch extracts author", () => {
  expect(parseAuthorFromSearch("?author=abc123")).toBe("abc123");
  expect(parseAuthorFromSearch("?foo=bar")).toBeUndefined();
  expect(parseAuthorFromSearch("")).toBeUndefined();
});
