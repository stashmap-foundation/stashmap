import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { findContacts } from "./contacts";
import { KIND_CONTACTLIST, newTimestamp } from "./nostr";
import { BOB_PUBLIC_KEY, CAROL_PUBLIC_KEY } from "./utils.test";

test("findContacts preserves relay and userName metadata", () => {
  const event = {
    kind: KIND_CONTACTLIST,
    pubkey: BOB_PUBLIC_KEY,
    created_at: newTimestamp(),
    tags: [["p", CAROL_PUBLIC_KEY, "wss://relay.example", "gardener"]],
    content: "",
  } as UnsignedEvent;

  const contacts = findContacts(List([event]));

  expect(contacts.get(CAROL_PUBLIC_KEY)).toEqual({
    publicKey: CAROL_PUBLIC_KEY,
    mainRelay: "wss://relay.example",
    userName: "gardener",
  });
});

test("findContacts preserves userName when relay is empty", () => {
  const event = {
    kind: KIND_CONTACTLIST,
    pubkey: BOB_PUBLIC_KEY,
    created_at: newTimestamp(),
    tags: [["p", CAROL_PUBLIC_KEY, "", "gardener"]],
    content: "",
  } as UnsignedEvent;

  const contacts = findContacts(List([event]));

  expect(contacts.get(CAROL_PUBLIC_KEY)).toEqual({
    publicKey: CAROL_PUBLIC_KEY,
    userName: "gardener",
  });
});
