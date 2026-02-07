import { Map } from "immutable";
import { hashText } from "./connections";
import { newDB } from "./knowledge";
import {
  stackToPath,
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

test("stackToPath and pathToStack round-trip preserves node IDs", () => {
  const knowledgeDBs = knowledgeDBWithNodes([
    { text: "Holiday Destinations" },
    { text: "Barcelona" },
  ]);
  const stack = [
    hashText("Holiday Destinations"),
    hashText("Barcelona"),
  ] as ID[];

  const path = stackToPath(stack, knowledgeDBs, ALICE_PK);
  expect(path).toBe("/n/Holiday%20Destinations/Barcelona");
  expect(pathToStack(path as string)).toEqual(stack);
});

test("stackToPath returns undefined when node text cannot be resolved", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  const stack = [hashText("Some Node")] as ID[];

  const path = stackToPath(stack, emptyDBs, ALICE_PK);
  expect(path).toBeUndefined();
});

test("stackToPath with empty stack returns /", () => {
  const emptyDBs = Map<PublicKey, KnowledgeData>();
  expect(stackToPath([], emptyDBs, ALICE_PK)).toBe("/");
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
