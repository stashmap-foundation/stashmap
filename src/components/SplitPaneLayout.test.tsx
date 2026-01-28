import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaneIndexProvider } from "../SplitPanesContext";
import { ClosePaneButton } from "./SplitPaneLayout";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  renderApis,
  renderApp,
  setup,
} from "../utils.test";

test("Closing a middle pane does not crash", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Test Node{Escape}");

  await expectTree(`
My Notes
  Test Node
  `);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);

  await expectTree(`
My Notes
  Test Node
My Notes
  Test Node
My Notes
  Test Node
  `);

  const closeButtons = screen.getAllByLabelText("Close pane");
  await userEvent.click(closeButtons[0]);

  await expectTree(`
My Notes
  Test Node
My Notes
  Test Node
  `);
});

test("ClosePaneButton returns null for pane index 0", () => {
  renderApis(
    <PaneIndexProvider index={0}>
      <ClosePaneButton />
    </PaneIndexProvider>
  );

  expect(screen.queryByLabelText("Close pane")).toBeNull();
});

test("ClosePaneButton renders for pane index > 0", () => {
  renderApis(
    <PaneIndexProvider index={1}>
      <ClosePaneButton />
    </PaneIndexProvider>
  );

  expect(screen.getByLabelText("Close pane")).toBeTruthy();
});
