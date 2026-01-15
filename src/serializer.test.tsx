import { joinID } from "./connections";
import { KIND_KNOWLEDGE_LIST, KIND_PROJECT } from "./nostr";
import {
  eventToTextOrProjectNode,
  eventToRelations,
  jsonToViews,
} from "./serializer";
import { ALICE } from "./utils.test";

test("parse project", () => {
  const event = {
    kind: KIND_PROJECT,
    tags: [
      ["d", "123"],
      ["address", "525 S. Winchester Blvd. San Jose, CA 95128"],
      ["imeta", "url https://winchestermysteryhouse.com/wp"],
      ["r", "wss://winchester.deedsats.com/"],
      ["r", "wss://nos.lol/", "read"],
      ["c", "dashboard-internal"],
      ["perpetualVotes", "d"],
      ["quarterlyVotes", "e"],
      ["dashboardPublic", "f"],
      ["tokenSupply", "1000000"],
      ["memberListProvider", ALICE.publicKey],
    ],
    pubkey: ALICE.publicKey,
    content: "Winchester Mystery House",
    created_at: Math.floor(new Date("2009-01-03T18:15:05Z").getTime() / 1000),
  };
  const [id, p] = eventToTextOrProjectNode(event);
  const project = p as ProjectNode;
  expect(id).toEqual("123");

  expect(project).toEqual({
    id: joinID(ALICE.publicKey, "123"),
    relays: [
      { url: "wss://winchester.deedsats.com/", write: true, read: true },
      { url: "wss://nos.lol/", write: false, read: true },
    ],
    address: "525 S. Winchester Blvd. San Jose, CA 95128",
    imageUrl: "https://winchestermysteryhouse.com/wp",
    perpetualVotes: "d",
    quarterlyVotes: "e",
    dashboardInternal: "dashboard-internal",
    dashboardPublic: "f",
    text: "Winchester Mystery House",
    tokenSupply: 1000000,
    createdAt: new Date("2009-01-03T18:15:05Z"),
    memberListProvider: ALICE.publicKey,
    type: "project",
  });
});

test("parse project with undefined tokensupply", () => {
  const event = {
    kind: KIND_PROJECT,
    tags: [
      ["d", "3110"],
      ["r", "wss://projectwithouttokens.deedsats.com/"],
      ["r", "wss://nos.lol/", "read"],
      ["memberListProvider", ALICE.publicKey],
    ],
    pubkey: ALICE.publicKey,
    content: "Project without tokens",
    created_at: Math.floor(new Date("2009-01-03T18:15:05Z").getTime() / 1000),
  };
  const [id, p] = eventToTextOrProjectNode(event);
  const project = p as ProjectNode;
  expect(id).toEqual("3110");

  expect(project).toEqual({
    id: joinID(ALICE.publicKey, "3110"),
    relays: [
      {
        url: "wss://projectwithouttokens.deedsats.com/",
        write: true,
        read: true,
      },
      { url: "wss://nos.lol/", write: false, read: true },
    ],
    address: undefined,
    imageUrl: undefined,
    perpetualVotes: undefined,
    quarterlyVotes: undefined,
    dashboardInternal: undefined,
    dashboardPublic: undefined,
    text: "Project without tokens",
    tokenSupply: undefined,
    createdAt: new Date("2009-01-03T18:15:05Z"),
    memberListProvider: ALICE.publicKey,
    type: "project",
  });
});

describe("eventToRelations validation", () => {
  test("filters invalid relevance values to default (empty string)", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-123"],
        ["k", "head-node"],
        ["i", "node1", "relevant"], // valid
        ["i", "node2", "invalid_relevance"], // invalid -> ""
        ["i", "node3", ""], // valid (maybe relevant)
        ["i", "node4", "little_relevant"], // valid
        ["i", "node5", "old_type_that_no_longer_exists"], // invalid -> ""
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.items.size).toBe(5);
    expect(relations!.items.get(0)?.relevance).toBe("relevant");
    expect(relations!.items.get(1)?.relevance).toBe(""); // filtered to default
    expect(relations!.items.get(2)?.relevance).toBe("");
    expect(relations!.items.get(3)?.relevance).toBe("little_relevant");
    expect(relations!.items.get(4)?.relevance).toBe(""); // filtered to default
  });

  test("filters invalid argument values to undefined", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-456"],
        ["k", "head-node"],
        ["i", "node1", "", "confirms"], // valid argument
        ["i", "node2", "", "contra"], // valid argument
        ["i", "node3", "", "invalid_argument"], // invalid -> undefined
        ["i", "node4", "", ""], // empty string -> undefined
        ["i", "node5", ""], // no argument -> undefined
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.items.size).toBe(5);
    expect(relations!.items.get(0)?.argument).toBe("confirms");
    expect(relations!.items.get(1)?.argument).toBe("contra");
    expect(relations!.items.get(2)?.argument).toBeUndefined(); // filtered
    expect(relations!.items.get(3)?.argument).toBeUndefined(); // empty -> undefined
    expect(relations!.items.get(4)?.argument).toBeUndefined();
  });
});

describe("jsonToViews validation", () => {
  test("filters invalid typeFilter values", () => {
    // View path format: "p{paneIndex}:{nodeId}:{nodeIndex}"
    const json = {
      "p0:node1:0": {
        f: [
          "relevant", // valid
          "", // valid (maybe relevant)
          "confirms", // valid
          "contra", // valid
          "suggestions", // valid
          "invalid_filter", // invalid -> filtered out
          "old_type", // invalid -> filtered out
        ],
      },
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node1:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toEqual([
      "relevant",
      "",
      "confirms",
      "contra",
      "suggestions",
    ]);
  });

  test("handles empty typeFilters", () => {
    const json = {
      "p0:node2:0": {
        f: [],
      },
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node2:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toEqual([]);
  });

  test("handles undefined typeFilters", () => {
    const json = {
      "p0:node3:0": {},
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node3:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toBeUndefined();
  });
});
