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
  RootViewOrPaneIsLoading,
  type,
} from "../utils.test";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { PaneView } from "./Workspace";
import { MockRelayPool } from "../nostrMock.test";

test("Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());
  await type("Root{Enter}New Note{Escape}");
  await screen.findByLabelText("edit New Note");
  await userEvent.click(
    await screen.findByLabelText("publishing status", undefined, { timeout: 5000 })
  );
  await screen.findByText("relay.test.first.success/");
});

test("Details of Publishing Status", async () => {
  const [alice] = setup([ALICE]);
  const utils = alice();
  renderWithTestData(
    <>
      <RootViewOrPaneIsLoading>
        <PublishingStatusWrapper />
        <PaneView />
      </RootViewOrPaneIsLoading>
    </>,
    {
      ...utils,
      relayPool: {
        ...utils.relayPool,
        publish: (relays: Array<string>, event: Event): Promise<string>[] => {
          const results = relays.map((_, i) => {
            if (event.kind === 34751) {
              if (i === 0 || i === 3) return Promise.resolve("fulfilled");
              if (i === 1) return Promise.reject(new Error("paid relay"));
              return Promise.reject(new Error("too many requests"));
            }
            if (i === 1) return Promise.reject(new Error("paid relay"));
            return Promise.resolve("fulfilled");
          });
          return results;
        },
      } as unknown as MockRelayPool,
      relays: { ...utils.relays, userRelays: TEST_RELAYS },
    }
  );
  await type("Root{Enter}Hello World{Escape}");
  const publishingStatusButtons = await screen.findAllByLabelText(
    "publishing status"
  );
  await userEvent.click(publishingStatusButtons[0]);
  await screen.findByText("relay.test.first.success/");
  await screen.findByText("relay.test.fourth.success/");

  await screen.findByText("relay.test.third.rand/");
  await screen.findByText("Error: too many requests");

  await screen.findByText("relay.test.second.fail/");
  await screen.findByText("Error: paid relay");
});
