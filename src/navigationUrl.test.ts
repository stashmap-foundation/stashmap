import { Map } from "immutable";
import { hashText } from "./connections";
import { newDB } from "./knowledge";
import {
  buildNodeUrl,
  pathToStack,
  parseRelationUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";

const ALICE_PK = "alice-pub-key" as PublicKey;

function knowledgeDBWithNodes(nodes: Array<{ text: string }>): KnowledgeDBs {
  const db: KnowledgeData = {
    ...newDB(),
    nodes: Map(
      nodes.map((n) => [
        hashText(n.text),
        { text: n.text, id: hashText(n.text) },
      ])
    ) as KnowledgeData["nodes"],
  };
  return Map<PublicKey, KnowledgeData>({ [ALICE_PK]: db });
}

test("buildNodeUrl and pathToStack round-trip preserves node IDs", () => {
  const knowledgeDBs = knowledgeDBWithNodes([
    { text: "Holiday Destinations" },
    { text: "Barcelona" },
  ]);
  const stack = [
    hashText("Holiday Destinations"),
    hashText("Barcelona"),
  ] as ID[];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK);
  expect(path).toBe("/n/Holiday%20Destinations/Barcelona");
  expect(pathToStack(path as string)).toEqual(stack);
});

test("buildNodeUrl returns undefined when node text cannot be resolved", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  const stack = [hashText("Some Node")] as ID[];

  const path = buildNodeUrl(stack, emptyDBs, ALICE_PK);
  expect(path).toBeUndefined();
});

test("buildNodeUrl with empty stack returns /", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  expect(buildNodeUrl([], emptyDBs, ALICE_PK)).toBe("/");
});

test("buildNodeUrl includes author param for other user", () => {
  const knowledgeDBs = knowledgeDBWithNodes([{ text: "My Notes" }]);
  const stack = [hashText("My Notes")] as ID[];
  const otherAuthor = "other-author" as PublicKey;

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK, otherAuthor);
  expect(path).toBe("/n/My%20Notes?author=other-author");
});

test("buildNodeUrl omits author param for own content", () => {
  const knowledgeDBs = knowledgeDBWithNodes([{ text: "My Notes" }]);
  const stack = [hashText("My Notes")] as ID[];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK, ALICE_PK);
  expect(path).toBe("/n/My%20Notes");
});

test("pathToStack with non /n/ path returns empty array", () => {
  expect(pathToStack("/")).toEqual([]);
  expect(pathToStack("/profile")).toEqual([]);
  expect(pathToStack("/n/")).toEqual([]);
});

test("parseRelationUrl extracts relation ID", () => {
  expect(parseRelationUrl("/r/some-relation-id")).toBe("some-relation-id");
  expect(parseRelationUrl("/r/encoded%2Fid")).toBe("encoded/id");
  expect(parseRelationUrl("/n/something")).toBeUndefined();
  expect(parseRelationUrl("/")).toBeUndefined();
});

test("parseAuthorFromSearch extracts author", () => {
  expect(parseAuthorFromSearch("?author=abc123")).toBe("abc123");
  expect(parseAuthorFromSearch("?foo=bar")).toBeUndefined();
  expect(parseAuthorFromSearch("")).toBeUndefined();
});
