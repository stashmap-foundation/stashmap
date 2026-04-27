import { List, Map } from "immutable";
import { shortID } from "./connections";
import { newDB } from "./knowledge";
import { newNode } from "./ViewContext";
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
): { knowledgeDBs: KnowledgeDBs; nodes: GraphNode[] } {
  const nodesWithCreated = texts.reduce(
    (acc, text) => {
      const node = newNode(text, List<ID>(), author);
      return {
        nodes: acc.nodes.set(shortID(node.id), node),
        created: [...acc.created, node],
      };
    },
    { nodes: Map<string, GraphNode>(), created: [] as GraphNode[] }
  );
  const { nodes } = nodesWithCreated;
  const db: KnowledgeData = {
    ...newDB(),
    nodes,
  };
  return {
    knowledgeDBs: Map<PublicKey, KnowledgeData>({ [author]: db }),
    nodes: nodesWithCreated.created,
  };
}

test("buildNodeUrl renders concrete node IDs as readable path labels", () => {
  const { knowledgeDBs, nodes } = knowledgeDBWithTexts(ALICE_PK, [
    "Holiday Destinations",
    "Barcelona",
  ]);
  const stack = nodes.map((node) => node.id as ID);

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK);
  expect(path).toBe("/n/Holiday%20Destinations/Barcelona");
  expect(pathToStack(path as string)).toEqual([
    "Holiday Destinations",
    "Barcelona",
  ]);
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
  const { knowledgeDBs, nodes } = knowledgeDBWithTexts(OTHER_PK, ["My Notes"]);
  const stack = [nodes[0].id as ID];

  const path = buildNodeUrl(stack, knowledgeDBs, ALICE_PK, OTHER_PK);
  expect(path).toBe("/n/My%20Notes?author=other-author");
});

test("buildNodeUrl omits author param for own content", () => {
  const { knowledgeDBs, nodes } = knowledgeDBWithTexts(ALICE_PK, ["My Notes"]);
  const stack = [nodes[0].id as ID];

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
