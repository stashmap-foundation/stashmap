import React, { useState } from "react";
import { useBackend, WorkspaceState } from "../BackendContext";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";

type CreateModalState = { initialFolder: string | null } | null;

function EmptyStateButtons({
  workspace,
  onCreate,
  onOpenFolder,
}: {
  workspace: WorkspaceState;
  onCreate: () => void;
  onOpenFolder: () => void;
}): JSX.Element {
  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100 gap-3">
      <h2>No workspace selected</h2>
      <div className="d-flex gap-2">
        <button
          type="button"
          className="btn btn-outline-dark"
          onClick={onCreate}
          aria-label="Create Workspace"
        >
          Create Workspace
        </button>
        <button
          type="button"
          className="btn btn-outline-dark"
          onClick={onOpenFolder}
          aria-label="Open Folder as Workspace"
        >
          Open Folder as Workspace
        </button>
      </div>
      <noscript>{workspace ? "" : ""}</noscript>
    </div>
  );
}

export function NoWorkspaceEmptyState(): JSX.Element {
  const { workspace } = useBackend();
  const [createModal, setCreateModal] = useState<CreateModalState>(null);

  if (!workspace) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100">
        Workspace controls are not available in this build.
      </div>
    );
  }

  const handleOpenFolder = async (): Promise<void> => {
    const folder = await workspace.pickFolder();
    if (!folder) {
      return;
    }
    if (await workspace.isInitialised(folder)) {
      await workspace.open(folder);
      return;
    }
    setCreateModal({ initialFolder: folder });
  };

  return (
    <>
      <EmptyStateButtons
        workspace={workspace}
        onCreate={() => setCreateModal({ initialFolder: null })}
        onOpenFolder={handleOpenFolder}
      />
      {createModal && (
        <CreateWorkspaceModal
          initialFolder={createModal.initialFolder}
          onCancel={() => setCreateModal(null)}
          pickFolder={workspace.pickFolder}
          onCreate={async ({ folder, secretKeyInput }) => {
            await workspace.create({ folder, secretKeyInput });
            setCreateModal(null);
          }}
        />
      )}
    </>
  );
}
