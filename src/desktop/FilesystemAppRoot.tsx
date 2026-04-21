import React from "react";
import { useBackend } from "../BackendContext";
import { NoWorkspaceEmptyState } from "./NoWorkspaceEmptyState";

export function FilesystemAppRoot({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { workspace } = useBackend();
  if (workspace && workspace.profile === null) {
    return <NoWorkspaceEmptyState />;
  }
  return <>{children}</>;
}
