import React from "react";
import { Outlet } from "react-router-dom";

import { NavbarControls } from "./NavbarControls";
import { SplitPaneLayout } from "./SplitPaneLayout";
import {
  SplitPanesProvider,
  PaneNavigationProvider,
  PaneIndexProvider,
  usePaneNavigation,
  usePaneIndex,
} from "../SplitPanesContext";
import { RootViewContextProvider } from "../ViewContext";
import { LoadNode } from "../dataQuery";
import { StorePreLoginContext } from "../StorePreLoginContext";
import { useWorkspaceContext } from "../WorkspaceContext";

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

// Inner component that uses pane navigation context
function RootViewOrWorkspaceIsLoadingInner({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { activeWorkspace } = usePaneNavigation();
  const paneIndex = usePaneIndex();

  return (
    <RootViewContextProvider root={activeWorkspace as LongID} paneIndex={paneIndex}>
      <LoadNode waitForEose>
        <StorePreLoginContext>{children}</StorePreLoginContext>
      </LoadNode>
    </RootViewContextProvider>
  );
}

// Exported for tests - wraps with pane providers
export function RootViewOrWorkspaceIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { activeWorkspace } = useWorkspaceContext();

  return (
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={activeWorkspace}>
          <RootViewOrWorkspaceIsLoadingInner>
            {children}
          </RootViewOrWorkspaceIsLoadingInner>
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );
}

function Dashboard(): JSX.Element {
  return (
    <SplitPanesProvider>
      <StorePreLoginContext>
        <AppLayout>
          <Outlet />
          <SplitPaneLayout />
        </AppLayout>
      </StorePreLoginContext>
    </SplitPanesProvider>
  );
}
export default Dashboard;
