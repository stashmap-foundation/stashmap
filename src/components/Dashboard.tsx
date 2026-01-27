import React from "react";
import { Outlet } from "react-router-dom";

import { NavbarControls } from "./NavbarControls";
import { SplitPaneLayout } from "./SplitPaneLayout";
import { StorePreLoginContext } from "../StorePreLoginContext";

export function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="h-100 w-100 position-absolute knowledge-exchange">
      <div
        id="app-container"
        className="menu-sub-hidden main-hidden sub-hidden h-100 d-flex flex-column"
      >
        <div className="workspace-navbar-controls">
          <NavbarControls />
        </div>
        {children}
      </div>
    </div>
  );
}

function Dashboard(): JSX.Element {
  return (
    <StorePreLoginContext>
      <AppLayout>
        <Outlet />
        <SplitPaneLayout />
      </AppLayout>
    </StorePreLoginContext>
  );
}
export default Dashboard;
