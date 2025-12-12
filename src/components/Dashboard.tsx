import React from "react";
import { Outlet } from "react-router-dom";

import { WorkspaceView } from "./Workspace";
import { NavbarControls } from "./NavbarControls";

import { LoadNode } from "../dataQuery";
import { StorePreLoginContext } from "../StorePreLoginContext";
import { RootViewContextProvider } from "../ViewContext";
import { useStack } from "../NavigationStackContext";

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

export function RootViewOrWorkspaceIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const stack = useStack();
  const activeWorkspaceID = stack[stack.length - 1] as LongID;

  return (
    <RootViewContextProvider root={activeWorkspaceID}>
      <LoadNode waitForEose>
        <StorePreLoginContext>{children}</StorePreLoginContext>
      </LoadNode>
    </RootViewContextProvider>
  );
}

function Dashboard(): JSX.Element {
  return (
    <RootViewOrWorkspaceIsLoading>
      <AppLayout>
        <Outlet />
        <WorkspaceView />
      </AppLayout>
    </RootViewOrWorkspaceIsLoading>
  );
}
export default Dashboard;
