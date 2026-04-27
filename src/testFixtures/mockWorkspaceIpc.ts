import fs from "fs";
import path from "path";
import crypto from "crypto";
import { hexToBytes } from "@noble/hashes/utils";
import { loadCliProfile } from "../cli/config";
import { createWorkspaceProfile } from "../cli/init";
import {
  buildWorkspaceDocumentContent,
  loadWorkspaceAsDocuments,
  saveDocumentsToWorkspace,
} from "../core/workspaceBackend";
import {
  FsEvent,
  FsEventHandler,
  WorkspaceWatcher,
  watchWorkspace,
} from "../core/workspaceWatcher";
import { convertInputToPrivateKey } from "../nostrKey";
import {
  WorkspaceIpc,
  WorkspaceLoaded,
} from "../infra/filesystem/FilesystemBackendProvider";

const ECHO_TTL_MS = 2000;

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export type MockWorkspaceIpc = WorkspaceIpc & {
  setCurrent: (workspaceDir: string | null) => void;
  queuePickedFolder: (folder: string | null) => void;
  getCurrent: () => string | null;
  dispose: () => Promise<void>;
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
    fsHandlers: Set<FsEventHandler>;
    watcher: Promise<WorkspaceWatcher> | null;
    pendingEchoes: Map<string, { hash: string; expiresAt: number }>;
    pendingUnlinkEchoes: Map<string, number>;
  } = {
    current: initialCurrent,
    pickerQueue: [],
    fsHandlers: new Set(),
    watcher: null,
    pendingEchoes: new Map(),
    pendingUnlinkEchoes: new Map(),
  };

  const isOwnEcho = (event: FsEvent): boolean => {
    const now = Date.now();
    if (event.type === "unlink") {
      const expiresAt = state.pendingUnlinkEchoes.get(event.relativePath);
      if (expiresAt && expiresAt > now) {
        state.pendingUnlinkEchoes.delete(event.relativePath);
        return true;
      }
      return false;
    }
    const pending = state.pendingEchoes.get(event.relativePath);
    if (
      pending &&
      pending.expiresAt > now &&
      pending.hash === hashContent(event.content)
    ) {
      state.pendingEchoes.delete(event.relativePath);
      return true;
    }
    return false;
  };

  const emit: FsEventHandler = (event) => {
    if (isOwnEcho(event)) return;
    state.fsHandlers.forEach((handler) => handler(event));
  };

  const ensureWatcher = (): void => {
    if (state.watcher || !state.current) return;
    // eslint-disable-next-line functional/immutable-data
    state.watcher = watchWorkspace(state.current, emit);
  };

  const stopWatcher = async (): Promise<void> => {
    if (!state.watcher) return;
    const pending = state.watcher;
    // eslint-disable-next-line functional/immutable-data
    state.watcher = null;
    const instance = await pending;
    await instance.close();
  };

  const setCurrentFolder = async (folder: string | null): Promise<void> => {
    await stopWatcher();
    // eslint-disable-next-line functional/immutable-data
    state.current = folder;
    ensureWatcher();
  };

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
      if (!state.current) {
        return { changed_paths: [], removed_paths: [] };
      }
      const profile = loadCliProfile({ cwd: state.current });
      const expiresAt = Date.now() + ECHO_TTL_MS;
      documents.forEach((doc) => {
        if (doc.filePath !== undefined) {
          state.pendingEchoes.set(doc.filePath, {
            hash: hashContent(
              buildWorkspaceDocumentContent(doc.content, doc.docId)
            ),
            expiresAt,
          });
        }
      });
      (deletedPaths ?? []).forEach((relativePath) => {
        state.pendingUnlinkEchoes.set(relativePath, expiresAt);
      });
      return saveDocumentsToWorkspace(
        { pubkey: profile.pubkey, workspaceDir: profile.workspaceDir },
        documents,
        deletedPaths
      );
    },
    subscribeFsEvents: (handler) => {
      state.fsHandlers.add(handler);
      ensureWatcher();
      return () => {
        state.fsHandlers.delete(handler);
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
      state.fsHandlers.clear();
      await stopWatcher();
    },
  };
}
