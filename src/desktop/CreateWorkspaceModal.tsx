import React, { useState } from "react";
import { Form } from "react-bootstrap";
import { ModalForm } from "../commons/ModalForm";
import { convertInputToPrivateKey } from "../nostrKey";

type Props = {
  initialFolder: string | null;
  onCancel: () => void;
  onCreate: (args: {
    folder: string;
    secretKeyInput?: string;
  }) => Promise<void>;
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

  const submit = async (form: HTMLFormElement): Promise<void> => {
    if (!folder) {
      throw new Error("Pick a folder for the new workspace");
    }
    const seedField = form.elements.namedItem(
      "seedInput"
    ) as HTMLInputElement | null;
    const seedInput = seedField?.value.trim() ?? "";
    if (seedInput && !convertInputToPrivateKey(seedInput)) {
      throw new Error("Input is not a valid nsec, private key or mnemonic");
    }
    await onCreate({
      folder,
      secretKeyInput: seedInput.length > 0 ? seedInput : undefined,
    });
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
      <Form.Group controlId="seedInput">
        <Form.Label>Existing nsec or 12-word seed (optional)</Form.Label>
        <Form.Control
          type="password"
          name="seedInput"
          placeholder="nsec, private key or mnemonic (12 words)"
        />
        <Form.Text className="text-muted">
          Leave empty to generate a fresh keypair.
        </Form.Text>
      </Form.Group>
    </ModalForm>
  );
}
