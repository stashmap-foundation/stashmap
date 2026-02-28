import { List } from "immutable";
import { KIND_KNOWLEDGE_DOCUMENT, KIND_KNOWLEDGE_LIST } from "./nostr";
import { eventToRelations, jsonToViews } from "./serializer";
import {
  buildDocumentEvents,
  createPlan,
  planUpsertNode,
  planUpsertRelations,
} from "./planner";
import { ALICE, setup } from "./utils.test";
import { newRelations } from "./ViewContext";
import { addRelationToRelations, newNode, shortID } from "./connections";
import { parseDocumentEvent } from "./markdownDocument";

describe("eventToRelations validation", () => {
  test("filters invalid relevance values to undefined (contains)", () => {
    const event = {
      kind: KIND_KNOWLEDGE_LIST,
      tags: [
        ["d", "rel-123"],
        ["k", "head-node"],
        ["i", "node1", "relevant"], // valid
        ["i", "node2", "invalid_relevance"], // invalid -> undefined
        ["i", "node3", ""], // empty string -> undefined (contains)
        ["i", "node4", "little_relevant"], // valid
        ["i", "node5", "old_type_that_no_longer_exists"], // invalid -> undefined
      ],
      pubkey: ALICE.publicKey,
      content: "",
      created_at: 1234567890,
    };

    const relations = eventToRelations(event);
    expect(relations).toBeDefined();
    expect(relations!.items.size).toBe(5);
    expect(relations!.items.get(0)?.relevance).toBe("relevant");
    expect(relations!.items.get(1)?.relevance).toBeUndefined(); // filtered to default
    expect(relations!.items.get(2)?.relevance).toBeUndefined(); // empty -> undefined
    expect(relations!.items.get(3)?.relevance).toBe("little_relevant");
    expect(relations!.items.get(4)?.relevance).toBeUndefined(); // filtered to default
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

test("filters out old abstract ref IDs (ref:) from items", () => {
  const event = {
    kind: KIND_KNOWLEDGE_LIST,
    tags: [
      ["d", "rel-200"],
      ["k", "head-node"],
      ["i", "node1", "relevant"],
      ["i", "ref:ctx1:ctx2:target1", "relevant"],
      ["i", "cref:alice_list123:node2", ""],
      ["i", "ref:ctx3:target2", ""],
    ],
    pubkey: ALICE.publicKey,
    content: "",
    created_at: 1234567890,
  };

  const relations = eventToRelations(event);
  expect(relations).toBeDefined();
  expect(relations!.items.size).toBe(2);
  expect(relations!.items.get(0)?.nodeID).toBe("node1");
  expect(relations!.items.get(1)?.nodeID).toBe("cref:alice_list123:node2");
});

describe("jsonToViews validation", () => {
  test("filters invalid typeFilter values", () => {
    const json = {
      views: {
        "p0:node1:0": {
          f: [
            "relevant",
            "", // empty string is migrated to "contains"
            "confirms",
            "contra",
            "suggestions",
            "invalid_filter",
            "old_type",
          ],
        },
      },
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node1:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toEqual([
      "relevant",
      "contains", // "" migrated to "contains"
      "confirms",
      "contra",
      "suggestions",
    ]);
  });

  test("handles empty typeFilters", () => {
    const json = {
      views: {
        "p0:node2:0": {
          f: [],
        },
      },
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node2:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toEqual([]);
  });

  test("handles undefined typeFilters", () => {
    const json = {
      views: {
        "p0:node3:0": {},
      },
    };

    const views = jsonToViews(json);
    const view = views.get("p0:node3:0");
    expect(view).toBeDefined();
    expect(view!.typeFilters).toBeUndefined();
  });
});

describe("basedOn serialization round-trip", () => {
  test("relation with basedOn serializes in document and parses back", () => {
    const [alice] = setup([ALICE]);
    const rootNode = newNode("Root");
    const childNode = newNode("Child");
    const sourceRelationID = "bob_source-relation-123" as LongID;
    const plan = createPlan(alice());
    const rootRelations = addRelationToRelations(
      newRelations(rootNode.id, List<ID>(), plan.user.publicKey),
      childNode.id
    );
    const childRelations = {
      ...newRelations(
        childNode.id,
        List<ID>([shortID(rootNode.id) as ID]),
        plan.user.publicKey
      ),
      basedOn: sourceRelationID,
    };
    const planWithRelation = planUpsertRelations(
      planUpsertRelations(
        planUpsertNode(planUpsertNode(plan, rootNode), childNode),
        rootRelations
      ),
      childRelations
    );
    const events = buildDocumentEvents(planWithRelation);
    const event = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

    expect(event).toBeDefined();

    const parsed = parseDocumentEvent(event!);
    const relationWithBasedOn = parsed.relations.find(
      (relation) => relation.basedOn !== undefined
    );
    expect(relationWithBasedOn).toBeDefined();
    expect(relationWithBasedOn!.basedOn).toContain(sourceRelationID);
  });

  test("relation without basedOn does not produce basedOn in parsed document", () => {
    const [alice] = setup([ALICE]);
    const rootNode = newNode("Root");
    const childNode = newNode("Child");
    const plan = createPlan(alice());
    const rootRelations = addRelationToRelations(
      newRelations(rootNode.id, List<ID>(), plan.user.publicKey),
      childNode.id
    );
    const childRelations = newRelations(
      childNode.id,
      List<ID>([shortID(rootNode.id) as ID]),
      plan.user.publicKey
    );
    const planWithRelation = planUpsertRelations(
      planUpsertRelations(
        planUpsertNode(planUpsertNode(plan, rootNode), childNode),
        rootRelations
      ),
      childRelations
    );
    const events = buildDocumentEvents(planWithRelation);
    const event = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

    expect(event).toBeDefined();

    const parsed = parseDocumentEvent(event!);
    const relationWithBasedOn = parsed.relations.find(
      (relation) => relation.basedOn !== undefined
    );
    expect(relationWithBasedOn).toBeUndefined();
  });
});
