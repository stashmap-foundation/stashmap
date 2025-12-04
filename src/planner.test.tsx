import { planAddWorkspace, relayTags, createPlan } from "./planner";
import { ALICE, setup } from "./utils.test";
import { joinID } from "./connections";
import { KIND_WORKSPACE } from "./nostr";

test("planAddWorkspace should not create empty tags when workspace has no project", () => {
  const [alice] = setup([ALICE]);
  const workspace: Workspace = {
    id: joinID(ALICE.publicKey, "workspace-123"),
    node: joinID(ALICE.publicKey, "node-456"),
    project: undefined,
  };

  const plan = createPlan(alice());

  const result = planAddWorkspace(plan, workspace);

  expect(result.publishEvents.size).toBe(1);
  const event = result.publishEvents.get(0);

  expect(event?.kind).toBe(KIND_WORKSPACE);
  expect(event?.tags).toEqual([
    ["d", "workspace-123"],
    ["node", workspace.node],
  ]);

  // Ensure no empty arrays in tags
  event?.tags.forEach((tag) => {
    expect(tag.length).toBeGreaterThan(0);
  });
});

test("planAddWorkspace should include project tag when workspace has a project", () => {
  const [alice] = setup([ALICE]);
  const workspace: Workspace = {
    id: joinID(ALICE.publicKey, "workspace-123"),
    node: joinID(ALICE.publicKey, "node-456"),
    project: joinID(ALICE.publicKey, "project-789"),
  };

  const plan = createPlan(alice());

  const result = planAddWorkspace(plan, workspace);

  expect(result.publishEvents.size).toBe(1);
  const event = result.publishEvents.get(0);

  expect(event?.kind).toBe(KIND_WORKSPACE);
  expect(event?.tags).toEqual([
    ["d", "workspace-123"],
    ["node", workspace.node],
    ["project", workspace.project],
  ]);

  // Ensure no empty arrays in tags
  event?.tags.forEach((tag) => {
    expect(tag.length).toBeGreaterThan(0);
  });
});

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
