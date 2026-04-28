import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaneIndexProvider } from "../SplitPanesContext";
import { ClosePaneButton } from "./SplitPaneLayout";
import {
  ALICE,
  expectTree,
  renderApis,
  renderApp,
  setup,
  type,
} from "../utils.test";

test("Closing a middle pane does not crash", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Test Node{Escape}");

  await expectTree(`
Root
  Test Node
  `);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  const collapseRootButtons1 = await screen.findAllByLabelText("collapse Root");
  expect(collapseRootButtons1.length).toBe(2);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  const collapseRootButtons2 = await screen.findAllByLabelText("collapse Root");
  expect(collapseRootButtons2.length).toBe(3);

  await expectTree(`
Root
  Test Node
Root
  Test Node
Root
  Test Node
  `);

  const closeButtons = screen.getAllByLabelText("Close pane");
  await userEvent.click(closeButtons[0]);

  await expectTree(`
Root
  Test Node
Root
  Test Node
  `);
});

test("Split pane layout survives browser refresh", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Test Node{Escape}");

  await expectTree(`
Root
  Test Node
  `);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await screen.findAllByLabelText("collapse Root");

  await expectTree(`
Root
  Test Node
Root
  Test Node
  `);

  await waitFor(() => {
    expect(window.history.state?.panes?.length).toBe(2);
  });

  const savedHistoryState = window.history.state;

  cleanup();

  const origPushState = window.history.pushState.bind(window.history);
  const pushStateSpy = jest
    .spyOn(window.history, "pushState")
    .mockImplementation(
      (_data: unknown, title: string, url?: string | URL | null) => {
        origPushState(savedHistoryState, title, url);
      }
    );

  renderApp(alice());

  pushStateSpy.mockRestore();

  await expectTree(`
Root
  Test Node
Root
  Test Node
  `);
});

test("ClosePaneButton renders for pane index 0", () => {
  renderApis(
    <PaneIndexProvider index={0}>
      <ClosePaneButton />
    </PaneIndexProvider>
  );

  expect(screen.getByLabelText("Close pane")).toBeTruthy();
});

test("ClosePaneButton renders for pane index > 0", () => {
  renderApis(
    <PaneIndexProvider index={1}>
      <ClosePaneButton />
    </PaneIndexProvider>
  );

  expect(screen.getByLabelText("Close pane")).toBeTruthy();
});
