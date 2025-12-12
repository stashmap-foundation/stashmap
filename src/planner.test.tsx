import { relayTags } from "./planner";

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
