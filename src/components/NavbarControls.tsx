import React from "react";
import { NotificationCenter } from "../commons/NotificationCenter";

export function NavbarControls(): JSX.Element {
  // Settings menu and PublishingStatus moved to first split pane header
  return (
    <div className="navbar-right d-flex align-items-center gap-2">
      <NotificationCenter />
    </div>
  );
}
