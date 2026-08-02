import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  setup,
  ALICE,
  renderApp,
  renderWithTestData,
  RootViewOrPaneIsLoading,
  type,
} from "../utils.test";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { PaneView } from "./Workspace";
import { MockRelayPool } from "../nostrMock.test";

test("Sync Status", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());
  await type("Root{Enter}New Note{Escape}");
  await screen.findByLabelText("edit New Note");
  await userEvent.click(
    await screen.findByLabelText("sync status", undefined, {
      timeout: 5000,
    })
  );
  await screen.findByText("relay.test.first.success/");
});

test("Sync Status displays storage and room routes", async () => {
  const [alice] = setup([ALICE]);
  renderWithTestData(
    <>
      <RootViewOrPaneIsLoading>
        <PublishingStatusWrapper />
        <PaneView />
      </RootViewOrPaneIsLoading>
    </>,
    {
      ...alice(),
      storageRelays: ["wss://storage.one/", "wss://storage.two/"],
      roomRelays: ["wss://room.one/", "wss://room.two/", "wss://room.three/"],
    }
  );

  await type("Root{Enter}Hello routes{Escape}");
  await userEvent.click((await screen.findAllByLabelText("sync status"))[0]);

  await screen.findByText("storage.one/");
  await screen.findByText("storage.two/");
  await screen.findByText("room.one/");
  await screen.findByText("room.two/");
  await screen.findByText("room.three/");
  expect(screen.getByLabelText("Storage relays")).toBeDefined();
  expect(screen.getByLabelText("Room relays")).toBeDefined();
});

test("Details of Sync Status", async () => {
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
        publish: (relays: Array<string>): Promise<string>[] => {
          const results = relays.map((_, i) => {
            if (i === 0 || i === 3) return Promise.resolve("fulfilled");
            if (i === 1) return Promise.reject(new Error("paid relay"));
            return Promise.reject(new Error("too many requests"));
          });
          return results;
        },
      } as unknown as MockRelayPool,
    }
  );
  await type("Root{Enter}Hello World{Escape}");
  const publishingStatusButtons = await screen.findAllByLabelText(
    "sync status"
  );
  await userEvent.click(publishingStatusButtons[0]);
  await screen.findByText("relay.test.first.success/");
  await screen.findByText("relay.test.fourth.success/");

  await screen.findByText("relay.test.third.rand/");
  await screen.findByText("Error: too many requests");

  await screen.findByText("relay.test.second.fail/");
  await screen.findByText("Error: paid relay");
});
