import { List } from "immutable";
import { KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { jsonToViews } from "./serializer";
import {
  buildDocumentEvents,
  createPlan,
  planUpsertRelations,
} from "./planner";
import { ALICE, setup } from "./utils.test";
import { newRelations } from "./ViewContext";
import {
  addRelationToRelations,
  hashText,
  newNode,
  shortID,
} from "./connections";
import { parseDocumentEvent } from "./markdownDocument";

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
        plan.user.publicKey,
        rootRelations.root
      ),
      basedOn: sourceRelationID,
    };
    const planWithRelation = planUpsertRelations(
      planUpsertRelations(plan, rootRelations),
      childRelations
    );
    const events = buildDocumentEvents(planWithRelation);
    const event = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

    expect(event).toBeDefined();

    const parsed = parseDocumentEvent(event!);
    const relationWithBasedOn = parsed.find((relation) => relation.basedOn !== undefined);
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
      plan.user.publicKey,
      rootRelations.root
    );
    const planWithRelation = planUpsertRelations(
      planUpsertRelations(plan, rootRelations),
      childRelations
    );
    const events = buildDocumentEvents(planWithRelation);
    const event = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

    expect(event).toBeDefined();

    const parsed = parseDocumentEvent(event!);
    const relationWithBasedOn = parsed.find((relation) => relation.basedOn !== undefined);
    expect(relationWithBasedOn).toBeUndefined();
  });

  test("document serialization prefers relation text over node text", () => {
    const [alice] = setup([ALICE]);
    const rootNode = newNode("Root Node");
    const childNode = newNode("Child Node");
    const rootLabel = "Root Relation";
    const childLabel = "Child Relation";
    const plan = createPlan(alice());
    const rootRelations = {
      ...addRelationToRelations(
        newRelations(rootNode.id, List<ID>(), plan.user.publicKey),
        childNode.id
      ),
      text: rootLabel,
      textHash: hashText(rootLabel),
    };
    const childRelations = {
      ...newRelations(
        childNode.id,
        List<ID>([shortID(rootNode.id) as ID]),
        plan.user.publicKey,
        rootRelations.root
      ),
      text: childLabel,
      textHash: hashText(childLabel),
    };
    const planWithRelation = planUpsertRelations(
      planUpsertRelations(plan, rootRelations),
      childRelations
    );

    const events = buildDocumentEvents(planWithRelation);
    const event = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

    expect(event).toBeDefined();
    expect(event!.content).toContain(`# ${rootLabel} {`);
    expect(event!.content).toContain(`- ${childLabel} {`);
    expect(event!.content).not.toContain(rootNode.text);
    expect(event!.content).not.toContain(childNode.text);
    expect(event!.tags).toEqual(
      expect.arrayContaining([
        ["n", hashText(rootLabel)],
        ["n", hashText(childLabel)],
      ])
    );

    const parsed = parseDocumentEvent(event!);
    expect(parsed.get(shortID(rootRelations.id))?.text).toBe(rootLabel);
    expect(parsed.get(shortID(childRelations.id))?.text).toBe(childLabel);
  });
});
