import fs from "fs";
import path from "path";
import { hexToBytes } from "@noble/hashes/utils";
import { loadCliProfile } from "../cli/config";
import { createWorkspaceProfile } from "../cli/init";
import {
  loadWorkspaceAsDocuments,
  saveDocumentsToWorkspace,
} from "../core/workspaceBackend";
import { convertInputToPrivateKey } from "../nostrKey";
import {
  WorkspaceIpc,
  WorkspaceLoaded,
} from "../infra/filesystem/FilesystemBackendProvider";

export type MockWorkspaceIpc = WorkspaceIpc & {
  setCurrent: (workspaceDir: string | null) => void;
  queuePickedFolder: (folder: string | null) => void;
  getCurrent: () => string | null;
};

async function loadFolder(workspaceDir: string): Promise<WorkspaceLoaded> {
  const profile = loadCliProfile({ cwd: workspaceDir });
  const documents = await loadWorkspaceAsDocuments({
    pubkey: profile.pubkey,
    workspaceDir: profile.workspaceDir,
  });
  return { profile, documents: [...documents] };
}

export function mockWorkspaceIpc(
  initialCurrent: string | null = null
): MockWorkspaceIpc {
  const state: {
    current: string | null;
    pickerQueue: (string | null)[];
  } = { current: initialCurrent, pickerQueue: [] };

  return {
    load: () =>
      state.current ? loadFolder(state.current) : Promise.resolve(null),
    pickFolder: () => {
      if (state.pickerQueue.length === 0) {
        throw new Error(
          "mockWorkspaceIpc.pickFolder: no folder queued for this call"
        );
      }
      // eslint-disable-next-line functional/immutable-data
      return Promise.resolve(state.pickerQueue.shift() ?? null);
    },
    open: (folder) => {
      // eslint-disable-next-line functional/immutable-data
      state.current = folder;
      return Promise.resolve();
    },
    create: ({ folder, secretKeyInput }) => {
      const secretKey = secretKeyInput
        ? (() => {
            const hex = convertInputToPrivateKey(secretKeyInput);
            if (!hex) {
              throw new Error(
                "Input is not a valid nsec, private key or mnemonic"
              );
            }
            return hexToBytes(hex);
          })()
        : undefined;
      createWorkspaceProfile({ workspaceDir: folder, secretKey });
      // eslint-disable-next-line functional/immutable-data
      state.current = folder;
      return Promise.resolve();
    },
    isInitialised: (folder) =>
      Promise.resolve(
        fs.existsSync(path.join(folder, ".knowstr", "profile.json"))
      ),
    save: async (documents, deletedPaths) => {
      if (!state.current) {
        return { changed_paths: [], removed_paths: [] };
      }
      const profile = loadCliProfile({ cwd: state.current });
      return saveDocumentsToWorkspace(
        { pubkey: profile.pubkey, workspaceDir: profile.workspaceDir },
        documents,
        deletedPaths
      );
    },
    setCurrent: (folder) => {
      // eslint-disable-next-line functional/immutable-data
      state.current = folder;
    },
    queuePickedFolder: (folder) => {
      // eslint-disable-next-line functional/immutable-data
      state.pickerQueue.push(folder);
    },
    getCurrent: () => state.current,
  };
}
