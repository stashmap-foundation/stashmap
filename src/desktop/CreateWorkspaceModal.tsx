import React, { useState } from "react";
import { Form } from "react-bootstrap";
import { ModalForm } from "../commons/ModalForm";

type Props = {
  initialFolder: string | null;
  onCancel: () => void;
  onCreate: (args: { folder: string }) => Promise<void>;
  pickFolder: () => Promise<string | null>;
};

export function CreateWorkspaceModal({
  initialFolder,
  onCancel,
  onCreate,
  pickFolder,
}: Props): JSX.Element {
  const [folder, setFolder] = useState<string | null>(initialFolder);

  const handlePickFolder = async (): Promise<void> => {
    const picked = await pickFolder();
    if (picked) {
      setFolder(picked);
    }
  };

  const submit = async (): Promise<void> => {
    if (!folder) {
      throw new Error("Pick a folder for the new workspace");
    }
    await onCreate({ folder });
  };

  return (
    <ModalForm
      title="Create Workspace"
      onHide={onCancel}
      submit={submit}
      hideAfterSubmit={false}
    >
      <Form.Group className="mb-3">
        <Form.Label>Workspace folder</Form.Label>
        <div className="d-flex align-items-center gap-2">
          <div
            aria-label="selected workspace folder"
            className="flex-grow-1 text-muted"
          >
            {folder ?? "(no folder picked)"}
          </div>
          <button
            type="button"
            className="btn btn-outline-dark"
            onClick={handlePickFolder}
            aria-label="pick folder for new workspace"
          >
            Pick Folder
          </button>
        </div>
      </Form.Group>
    </ModalForm>
  );
}
