import { KIND_KNOWLEDGE_LIST } from "./nostr";
import { eventToRelations, jsonToViews } from "./serializer";
import { ALICE } from "./utils.test";

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

describe("eventToRelations basedOn parsing", () => {
  test("parses basedOn from b tag", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-789"],
        ["k", "head-node"],
        ["b", "alice_original-relation-id"],
        ["i", "node1", ""],
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.basedOn).toBe("alice_original-relation-id");
  });

  test("basedOn is undefined when no b tag present", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-101"],
        ["k", "head-node"],
        ["i", "node1", ""],
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.basedOn).toBeUndefined();
  });

  test("parses context from multiple c tags", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-102"],
        ["k", "head-node"],
        ["c", "ancestor1"],
        ["c", "ancestor2"],
        ["c", "ancestor3"],
        ["i", "node1", ""],
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.context.toArray()).toEqual([
      "ancestor1",
      "ancestor2",
      "ancestor3",
    ]);
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
