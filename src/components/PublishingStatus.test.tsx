import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import { List } from "immutable";
import {
  setup,
  ALICE,
  renderApp,
  renderWithTestData,
  TEST_RELAYS,
  RootViewOrWorkspaceIsLoading,
} from "../utils.test";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { WorkspaceView } from "./Workspace";
import { MockRelayPool } from "../nostrMock.test";
import { newNode, addRelationToRelations } from "../connections";
import { execute } from "../executor";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { newRelations } from "../ViewContext";

test("Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  // Create a node programmatically to trigger event publishing
  const note = newNode("New Note", alice().user.publicKey);
  const rootRelations = addRelationToRelations(
    newRelations("ROOT", List(), alice().user.publicKey),
    note.id
  );
  await execute({
    ...alice(),
    plan: planUpsertRelations(
      planUpsertNode(createPlan(alice()), note),
      rootRelations
    ),
  });

  renderApp(alice());
  await screen.findByText("New Note");
  await userEvent.click(screen.getByLabelText("publishing status"));
  await screen.findByText("Publishing Status");
  expect(await screen.findAllByText("100%")).toHaveLength(4);
  screen.getByText("Relay wss://relay.test.first.success/:");
  expect(
    screen.getAllByText("2 of the last 2 events have been published")
  ).toHaveLength(4);
});

test("Details of Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  const utils = alice();

  // Create a node programmatically to trigger event publishing
  const note = newNode("Hello World", utils.user.publicKey);
  const rootRelations = addRelationToRelations(
    newRelations("ROOT", List(), utils.user.publicKey),
    note.id
  );

  // Mock relay pool with partial failures
  const mockRelayPool = {
    ...utils.relayPool,
    publish: (_relays: Array<string>, event: Event): Promise<string>[] => {
      if (event.kind === 34751) {
        return [
          Promise.resolve("fulfilled"),
          Promise.reject(new Error("paid relay")),
          Promise.reject(new Error("too many requests")),
          Promise.resolve("fulfilled"),
        ];
      }
      return [
        Promise.resolve("fulfilled"),
        Promise.reject(new Error("paid relay")),
        Promise.resolve("fulfilled"),
        Promise.resolve("fulfilled"),
      ];
    },
  } as unknown as MockRelayPool;

  // Execute the node creation with the mock relay pool
  await execute({
    ...utils,
    relayPool: mockRelayPool,
    plan: planUpsertRelations(
      planUpsertNode(createPlan(utils), note),
      rootRelations
    ),
  });

  renderWithTestData(
    <>
      <RootViewOrWorkspaceIsLoading>
        <PublishingStatusWrapper />
        <WorkspaceView />
      </RootViewOrWorkspaceIsLoading>
    </>,
    {
      ...utils,
      relayPool: mockRelayPool,
      relays: { ...utils.relays, userRelays: TEST_RELAYS },
    }
  );

  await screen.findByText("Hello World");
  const publishingStatusButtons = await screen.findAllByLabelText(
    "publishing status"
  );
  await userEvent.click(publishingStatusButtons[0]);
  await screen.findByText("Publishing Status");
  await userEvent.click(
    screen.getByText("Relay wss://relay.test.first.success/:")
  );
  screen.getByText("Relay wss://relay.test.fourth.success/:");
  expect(
    screen.getAllByText("2 of the last 2 events have been published")
  ).toHaveLength(2);

  screen.getByText("Relay wss://relay.test.third.rand/:");
  screen.getByText("0 of the last 2 events have been published");
  screen.getByText("Last rejection reason: Error: too many requests");

  screen.getByText("Relay wss://relay.test.second.fail/:");
  screen.getByText("0 of the last 2 events have been published");
  screen.getAllByText("Last rejection reason: Error: paid relay");
});
