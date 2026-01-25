import React from "react";
import { screen } from "@testing-library/react";
import {
  PaneIndexProvider,
  PaneNavigationProvider,
} from "../SplitPanesContext";
import { ClosePaneButton } from "./SplitPaneLayout";
import { ROOT } from "../types";
import { ALICE, renderApis } from "../utils.test";
import Data from "../Data";

test("ClosePaneButton returns null for pane index 0", () => {
  renderApis(
    <Data user={ALICE}>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={ROOT} author={ALICE.publicKey}>
          <ClosePaneButton />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </Data>
  );

  expect(screen.queryByLabelText("Close pane")).toBeNull();
});

test("ClosePaneButton renders for pane index > 0", () => {
  renderApis(
    <Data user={ALICE}>
      <PaneIndexProvider index={1}>
        <PaneNavigationProvider initialWorkspace={ROOT} author={ALICE.publicKey}>
          <ClosePaneButton />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </Data>
  );

  expect(screen.getByLabelText("Close pane")).toBeTruthy();
});
