import { List } from "immutable";
import {
  buildDocumentEvents,
  createPlan,
  planDeleteRelations,
  planUpsertRelations,
  relayTags,
} from "./planner";
import { ALICE, setup } from "./utils.test";
import { newNode } from "./connections";
import { newRelations } from "./ViewContext";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";

test("relayTags should filter out empty tags for relays with neither read nor write", () => {
  const relays: Relays = [
    { url: "wss://relay1.example.com", read: true, write: true },
    { url: "wss://relay2.example.com", read: true, write: false },
    { url: "wss://relay3.example.com", read: false, write: true },
    { url: "wss://relay4.example.com", read: false, write: false }, // This should be filtered out
  ];

  const tags = relayTags(relays);

  expect(tags).toEqual([
    ["r", "wss://relay1.example.com"],
    ["r", "wss://relay2.example.com", "read"],
    ["r", "wss://relay3.example.com", "write"],
  ]);

  // Ensure no empty arrays in tags
  tags.forEach((tag) => {
    expect(tag.length).toBeGreaterThan(0);
  });
});

test("relayTags should handle all relays with neither read nor write", () => {
  const relays: Relays = [
    { url: "wss://relay1.example.com", read: false, write: false },
    { url: "wss://relay2.example.com", read: false, write: false },
  ];

  const tags = relayTags(relays);

  expect(tags).toEqual([]);
});

test("relayTags should handle empty relay array", () => {
  const relays: Relays = [];

  const tags = relayTags(relays);

  expect(tags).toEqual([]);
});

test("deleting a standalone root publishes only a document delete", () => {
  const [alice] = setup([ALICE]);
  const root = newNode("Root");
  const rootRelations = newRelations(
    root.id,
    List(),
    alice().user.publicKey,
    undefined,
    undefined,
    root.text
  );

  const plan = planDeleteRelations(
    planUpsertRelations(createPlan(alice()), rootRelations),
    rootRelations.id
  );
  const events = buildDocumentEvents(plan);
  const deleteEvents = events.filter((event) => event.kind === KIND_DELETE);

  expect(deleteEvents.size).toBe(1);
  expect(deleteEvents.first()?.tags).toEqual(
    expect.arrayContaining([
      ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${alice().user.publicKey}:${rootRelations.root}`],
      ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
    ])
  );
});
