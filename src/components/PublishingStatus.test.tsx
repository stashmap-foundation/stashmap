import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import {
  setup,
  ALICE,
  renderApp,
  renderWithTestData,
  TEST_RELAYS,
  RootViewOrWorkspaceIsLoading,
  findNewNodeEditor,
} from "../utils.test";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { WorkspaceView } from "./Workspace";
import { MockRelayPool } from "../nostrMock.test";

test("Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "New Note{Enter}");
  await userEvent.type(await findNewNodeEditor(), "{Escape}");
  await userEvent.click(screen.getByLabelText("publishing status"));
  // New format shows relay names and counts like "4/4"
  expect(await screen.findAllByText("4/4")).toHaveLength(4);
  screen.getByText("relay.test.first.success/");
});

test("Details of Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  const utils = alice();
  renderWithTestData(
    <>
      <RootViewOrWorkspaceIsLoading>
        <PublishingStatusWrapper />
        <WorkspaceView />
      </RootViewOrWorkspaceIsLoading>
    </>,
    {
      ...utils,
      relayPool: {
        ...utils.relayPool,
        publish: (relays: Array<string>, event: Event): Promise<string>[] => {
          // Map promises to relay URLs for partial failure simulation
          const results = relays.map((_, i) => {
            if (event.kind === 34751) {
              // For relations: relay 1 & 4 succeed, relay 2 & 3 fail
              if (i === 0 || i === 3) return Promise.resolve("fulfilled");
              if (i === 1) return Promise.reject(new Error("paid relay"));
              return Promise.reject(new Error("too many requests"));
            }
            // For other events: relay 1, 3, 4 succeed, relay 2 fails
            if (i === 1) return Promise.reject(new Error("paid relay"));
            return Promise.resolve("fulfilled");
          });
          return results;
        },
      } as unknown as MockRelayPool,
      relays: { ...utils.relays, userRelays: TEST_RELAYS },
    }
  );
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Hello World{Enter}");
  const publishingStatusButtons = await screen.findAllByLabelText(
    "publishing status"
  );
  await userEvent.click(publishingStatusButtons[0]);
  // New format shows relay names without "Relay wss://" prefix
  await screen.findByText("relay.test.first.success/");
  screen.getByText("relay.test.fourth.success/");
  // Success counts shown as "4/4"
  expect(screen.getAllByText("4/4")).toHaveLength(2);

  screen.getByText("relay.test.third.rand/");
  screen.getByText("3/4");
  screen.getByText("Error: too many requests");

  screen.getByText("relay.test.second.fail/");
  screen.getByText("0/4");
  screen.getAllByText("Error: paid relay");
});
