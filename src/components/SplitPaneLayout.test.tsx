import React from "react";
import { screen } from "@testing-library/react";
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
  await userEvent.click(await screen.findByLabelText("expand Root"));

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await userEvent.click(await screen.findByLabelText("expand Root"));

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
