import React from "react";
import { Outlet } from "react-router-dom";

import { NavbarControls } from "./NavbarControls";
import { StorePreLoginContext } from "./StorePreLoginContext";
import { PaneHistoryProvider } from "../workspace/layout/PaneHistoryContext";
import { SplitPaneLayout } from "../workspace/layout/SplitPaneLayout";
import { DND } from "../workspace/tree/DND";

function AppLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="h-100 w-100 position-absolute knowledge-exchange">
      <div
        id="app-container"
        className="menu-sub-hidden main-hidden sub-hidden h-100 d-flex flex-column"
      >
        <div className="navbar-controls">
          <NavbarControls />
        </div>
        {children}
      </div>
    </div>
  );
}

function AppShell(): JSX.Element {
  return (
    <StorePreLoginContext>
      <AppLayout>
        <Outlet />
        <DND>
          <PaneHistoryProvider>
            <SplitPaneLayout />
          </PaneHistoryProvider>
        </DND>
      </AppLayout>
    </StorePreLoginContext>
  );
}
export default AppShell;
