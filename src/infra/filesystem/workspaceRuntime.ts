import crypto from "crypto";
import { loadCliProfile } from "../../cli/config";
import { ScannedWorkspaceDocument } from "./workspaceScan";
import {
  loadWorkspaceAsDocuments,
  saveDocumentsToWorkspace,
  WorkspaceWriteRequest,
} from "./workspaceBackend";
import type {
  FsEvent,
  FsEventHandler,
  WorkspaceWatcher,
} from "./workspaceWatcher";
import { watchWorkspace } from "./workspaceWatcher";

const ECHO_TTL_MS = 2000;

export type WorkspaceRuntimeLoaded = {
  profile: ReturnType<typeof loadCliProfile>;
  documents: ReadonlyArray<ScannedWorkspaceDocument>;
};

export type WorkspaceRuntime = {
  load: () => Promise<WorkspaceRuntimeLoaded>;
  ready: () => Promise<void>;
  save: (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  subscribeFsEvents: (handler: FsEventHandler) => () => void;
  dispose: () => Promise<void>;
};

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function logWorkspaceRuntimeDebug(
  label: string,
  details: Record<string, unknown>
): void {
  if (process.env.DEBUG_FS_WATCHER !== "1") {
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[workspace-runtime-debug]", { label, ...details });
}

export function createWorkspaceRuntime(workspaceDir: string): WorkspaceRuntime {
  const handlers = new Set<FsEventHandler>();
  const pendingEchoes = new Map<
    string,
    ReadonlyArray<{ hash: string; expiresAt: number }>
  >();
  const pendingUnlinkEchoes = new Map<string, number>();
  const state: { watcher: Promise<WorkspaceWatcher> | null } = {
    watcher: null,
  };

  const isOwnEcho = (event: FsEvent): boolean => {
    const now = Date.now();
    if (event.type === "unlink") {
      const expiresAt = pendingUnlinkEchoes.get(event.relativePath);
      if (expiresAt && expiresAt <= now) {
        pendingUnlinkEchoes.delete(event.relativePath);
        return false;
      }
      return expiresAt !== undefined;
    }

    const pending = pendingEchoes.get(event.relativePath) ?? [];
    const active = pending.filter((entry) => entry.expiresAt > now);
    if (active.length === 0) {
      pendingEchoes.delete(event.relativePath);
      return false;
    }
    pendingEchoes.set(event.relativePath, active);
    return active.some((entry) => entry.hash === hashContent(event.content));
  };

  const emit: FsEventHandler = (event) => {
    const ownEcho = isOwnEcho(event);
    logWorkspaceRuntimeDebug("emit", {
      type: event.type,
      relativePath: event.relativePath,
      ownEcho,
      handlerCount: handlers.size,
      workspaceDir,
      content: event.type === "change" ? event.content : undefined,
    });
    if (ownEcho) {
      return;
    }
    handlers.forEach((handler) => handler(event));
  };

  const ensureWatcher = (): void => {
    if (state.watcher) {
      return;
    }
    // eslint-disable-next-line functional/immutable-data
    state.watcher = watchWorkspace(workspaceDir, emit);
  };

  const recordSaveEchoes = (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths: ReadonlyArray<string> = []
  ): void => {
    const expiresAt = Date.now() + ECHO_TTL_MS;
    writes.forEach((write) => {
      const active = (pendingEchoes.get(write.relativePath) ?? []).filter(
        (entry) => entry.expiresAt > Date.now()
      );
      pendingEchoes.set(write.relativePath, [
        ...active,
        { hash: hashContent(write.content), expiresAt },
      ]);
    });
    deletedPaths.forEach((relativePath) => {
      pendingUnlinkEchoes.set(relativePath, expiresAt);
    });
  };

  return {
    load: async () => {
      const profile = loadCliProfile({ cwd: workspaceDir });
      const documents = await loadWorkspaceAsDocuments({
        pubkey: profile.pubkey,
        workspaceDir: profile.workspaceDir,
      });
      ensureWatcher();
      return { profile, documents: [...documents] };
    },
    ready: async () => {
      ensureWatcher();
      if (!state.watcher) {
        return;
      }
      const instance = await state.watcher;
      await instance.ready;
      logWorkspaceRuntimeDebug("ready", { workspaceDir });
    },
    save: async (documents, deletedPaths = []) => {
      const profile = loadCliProfile({ cwd: workspaceDir });
      recordSaveEchoes(documents, deletedPaths);
      return saveDocumentsToWorkspace(
        { pubkey: profile.pubkey, workspaceDir: profile.workspaceDir },
        documents,
        deletedPaths
      );
    },
    subscribeFsEvents: (handler) => {
      handlers.add(handler);
      logWorkspaceRuntimeDebug("subscribe", {
        handlerCount: handlers.size,
        workspaceDir,
      });
      ensureWatcher();
      return () => {
        handlers.delete(handler);
        logWorkspaceRuntimeDebug("unsubscribe", {
          handlerCount: handlers.size,
          workspaceDir,
        });
      };
    },
    dispose: async () => {
      handlers.clear();
      if (!state.watcher) {
        return;
      }
      const pending = state.watcher;
      // eslint-disable-next-line functional/immutable-data
      state.watcher = null;
      const instance = await pending;
      await instance.close();
    },
  };
}
