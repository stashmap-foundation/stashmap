import fs from "fs";
import path from "path";
import { hexToBytes } from "@noble/hashes/utils";
import { createWorkspaceProfile } from "../cli/init";
import { convertInputToPrivateKey } from "../nostrKey";
import {
  WorkspaceIpc,
  WorkspaceLoaded,
} from "../infra/filesystem/FilesystemBackendProvider";
import {
  createWorkspaceRuntime,
  WorkspaceRuntime,
} from "../infra/filesystem/workspaceRuntime";

function logMockWorkspaceDebug(
  label: string,
  details: Record<string, unknown>
): void {
  if (process.env.DEBUG_FS_WATCHER !== "1") {
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[mock-workspace-debug]", { label, ...details });
}

export type MockWorkspaceIpc = WorkspaceIpc & {
  setCurrent: (workspaceDir: string | null) => void;
  queuePickedFolder: (folder: string | null) => void;
  getCurrent: () => string | null;
  dispose: () => Promise<void>;
};

export function mockWorkspaceIpc(
  initialCurrent: string | null = null
): MockWorkspaceIpc {
  const state: {
    current: string | null;
    pickerQueue: (string | null)[];
    runtime: WorkspaceRuntime | null;
  } = {
    current: initialCurrent,
    pickerQueue: [],
    runtime: initialCurrent ? createWorkspaceRuntime(initialCurrent) : null,
  };

  const setCurrentFolder = async (folder: string | null): Promise<void> => {
    await state.runtime?.dispose();
    // eslint-disable-next-line functional/immutable-data
    state.current = folder;
    // eslint-disable-next-line functional/immutable-data
    state.runtime = folder ? createWorkspaceRuntime(folder) : null;
  };

  const getRuntime = (): WorkspaceRuntime | null => {
    if (!state.current) {
      return null;
    }
    if (!state.runtime) {
      // eslint-disable-next-line functional/immutable-data
      state.runtime = createWorkspaceRuntime(state.current);
    }
    return state.runtime;
  };

  return {
    load: () =>
      getRuntime()
        ?.load()
        .then(
          (loaded): WorkspaceLoaded => ({
            profile: loaded.profile,
            documents: [...loaded.documents],
          })
        ) ?? Promise.resolve(null),
    ready: async () => {
      await getRuntime()?.ready();
      logMockWorkspaceDebug("ready", { current: state.current });
    },
    pickFolder: () => {
      if (state.pickerQueue.length === 0) {
        throw new Error(
          "mockWorkspaceIpc.pickFolder: no folder queued for this call"
        );
      }
      // eslint-disable-next-line functional/immutable-data
      return Promise.resolve(state.pickerQueue.shift() ?? null);
    },
    open: async (folder) => {
      await setCurrentFolder(folder);
    },
    create: async ({ folder, secretKeyInput }) => {
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
      await setCurrentFolder(folder);
    },
    isInitialised: (folder) =>
      Promise.resolve(
        fs.existsSync(path.join(folder, ".knowstr", "profile.json"))
      ),
    save: async (documents, deletedPaths) => {
      return (
        (await getRuntime()?.save(documents, deletedPaths)) ?? {
          changed_paths: [],
          removed_paths: [],
        }
      );
    },
    subscribeFsEvents: (handler) => {
      logMockWorkspaceDebug("subscribe", {
        current: state.current,
      });
      const unsubscribe =
        getRuntime()?.subscribeFsEvents(handler) ?? (() => {});
      return () => {
        logMockWorkspaceDebug("unsubscribe", {
          current: state.current,
        });
        unsubscribe();
      };
    },
    setCurrent: (folder) => {
      setCurrentFolder(folder);
    },
    queuePickedFolder: (folder) => {
      // eslint-disable-next-line functional/immutable-data
      state.pickerQueue.push(folder);
    },
    getCurrent: () => state.current,
    dispose: async () => {
      await state.runtime?.dispose();
      // eslint-disable-next-line functional/immutable-data
      state.runtime = null;
    },
  };
}
