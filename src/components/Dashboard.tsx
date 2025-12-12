import React, { useEffect } from "react";
import { Outlet, useParams, useNavigate } from "react-router-dom";

import { Card } from "react-bootstrap";
import { StandaloneCard } from "../commons/Ui";
import { NavBar } from "./Navbar";

import { WorkspaceView } from "./Workspace";
import { NavbarControls } from "./NavbarControls";

import { useLogout } from "../NostrAuthContext";
import { LoadNode } from "../dataQuery";
import { StorePreLoginContext } from "../StorePreLoginContext";
import { useWorkspaceContext } from "../WorkspaceContext";
import { RootViewContextProvider } from "../ViewContext";
import { SelectWorkspaces } from "./SelectWorkspaces";
import { LongID, ROOT } from "../types";

export function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const logout = useLogout();
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

function WorkspaceIsLoading(): JSX.Element {
  return (
    <StandaloneCard>
      <div>
        <Card.Title className="text-center">
          <h1>Looking for your workspace...</h1>
        </Card.Title>
        <Card.Body>
          <h2>Taking longer than expected? You can:</h2>
          <ul>
            <li>
              Switching to another Workspace or create a new one using this
              dropdown
              <SelectWorkspaces />
            </li>
            <li>
              You can also try adding more <a href="/relays">relays</a>
            </li>
          </ul>
        </Card.Body>
      </div>
    </StandaloneCard>
  );
}

export function RootViewOrWorkspaceIsLoading({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { workspaceID } = useParams<{ workspaceID: string }>();


  if (!workspaceID) {
    return (
      <AppLayout>
        <StorePreLoginContext>
          <Outlet />
        </StorePreLoginContext>
      </AppLayout>
    );
  }

  return (
    <RootViewContextProvider root={workspaceID as LongID}>
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
