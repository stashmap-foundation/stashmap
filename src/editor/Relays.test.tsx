import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import { KIND_RELAY_METADATA_EVENT } from "../nostr";
import { Relays } from "./Relays";
import { ALICE, setup, renderApp, TEST_RELAYS } from "../utils.test";
import { relayTags } from "../planner";

const filterRelayMetadataEvents = (event: Event): boolean =>
  event.kind === KIND_RELAY_METADATA_EVENT;

test("Remove a Relay and add a suggested Relay", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderApp({ ...alice(), initialRoute: `/relays` });
  await screen.findByText("Edit Nostr Relays");
  screen.getByText("wss://relay.test.second.fail/");
  fireEvent.click(
    screen.getByLabelText("delete relay wss://relay.test.second.fail/")
  );
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      relayPool.getEvents().filter(filterRelayMetadataEvents)
    ).toHaveLength(1)
  );
  const secondRelay = TEST_RELAYS[1];
  const relaysWithoutSecond = TEST_RELAYS.filter(
    (r) => r.url !== secondRelay.url
  );
  const tags = relayTags(relaysWithoutSecond);
  const event = relayPool.getEvents().filter(filterRelayMetadataEvents)[0];
  expect(event).toEqual(
    expect.objectContaining({
      kind: 10002,
      pubkey:
        "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758",
      tags: expect.arrayContaining(tags),
      content: "",
    })
  );

  // relay is now shown as suggested and can be added
  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("edit relays"));
  await screen.findByText("Edit Nostr Relays");
  fireEvent.click(
    screen.getByLabelText("add relay wss://relay.test.second.fail/")
  );
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      relayPool.getEvents().filter(filterRelayMetadataEvents)
    ).toHaveLength(2)
  );
  const newTags = relayTags([...relaysWithoutSecond, secondRelay]);
  const newEvent = relayPool.getEvents().filter(filterRelayMetadataEvents)[1];
  expect(newEvent).toEqual(
    expect.objectContaining({
      kind: 10002,
      pubkey:
        "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758",
      tags: expect.arrayContaining(newTags),
      content: "",
    })
  );
});

test("Add a new Relay", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderApp({ ...alice(), initialRoute: `/relays` });
  await screen.findByText("Edit Nostr Relays");
  const inputRelay = screen.getByLabelText("add new relay");
  await userEvent.type(inputRelay, "wss://relay.test.fifth/");
  fireEvent.click(
    screen.getByLabelText("add new relay wss://relay.test.fifth/")
  );
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      relayPool.getEvents().filter(filterRelayMetadataEvents)
    ).toHaveLength(1)
  );
  const event = relayPool.getEvents().filter(filterRelayMetadataEvents)[0];
  const tags = relayTags([
    ...TEST_RELAYS,
    { url: "wss://relay.test.fifth/", read: true, write: true },
  ] as Relays);
  expect(event).toEqual(
    expect.objectContaining({
      kind: 10002,
      pubkey:
        "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758",
      tags: expect.arrayContaining(tags),
      content: "",
    })
  );
  expect(event.relays).toEqual([
    ...TEST_RELAYS.map((r) => r.url),
    // new relays
    "wss://relay.test.fifth/",
  ]);
});

test("Stop writing to an existing Nostr Relay", async () => {
  const [alice] = setup([ALICE]);
  const { relayPool } = renderApp({ ...alice(), initialRoute: `/relays` });
  await screen.findByText("Edit Nostr Relays");
  screen.getByText("wss://relay.test.fourth.success/");

  fireEvent.click(
    screen.getByLabelText(
      "stop writing to relay wss://relay.test.fourth.success/"
    )
  );
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      relayPool.getEvents().filter(filterRelayMetadataEvents)
    ).toHaveLength(1)
  );
  const event = relayPool.getEvents().filter(filterRelayMetadataEvents)[0];
  const tags = relayTags(
    TEST_RELAYS.map((r) =>
      r.url === "wss://relay.test.fourth.success/" ? { ...r, write: false } : r
    ) as Relays
  );
  expect(event).toEqual(
    expect.objectContaining({
      kind: 10002,
      pubkey:
        "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758",
      tags: expect.arrayContaining(tags),
      content: "",
    })
  );
});

// TODO: demonstrate that knowledge db is reloaded when editing a relay
// TODO: test adding relay with knowledge data
