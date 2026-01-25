import React from "react";
import { screen } from "@testing-library/react";
import { PaneIndexProvider } from "../SplitPanesContext";
import { ClosePaneButton } from "./SplitPaneLayout";
import { renderApis } from "../utils.test";

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
