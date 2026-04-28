import fsp from "fs/promises";
import path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { loadIgnorePatterns } from "./workspaceSave";

export type FsEvent =
  | { type: "add"; relativePath: string; content: string }
  | { type: "change"; relativePath: string; content: string }
  | { type: "unlink"; relativePath: string };

export type FsEventHandler = (event: FsEvent) => void;

export type WorkspaceWatcher = {
  ready: Promise<void>;
  close: () => Promise<void>;
};

export async function watchWorkspace(
  workspaceDir: string,
  emit: FsEventHandler
): Promise<WorkspaceWatcher> {
  const ig = await loadIgnorePatterns(workspaceDir);
  const toRelative = (absolute: string): string =>
    path.relative(workspaceDir, absolute);

  const watcher: FSWatcher = chokidar.watch(`${workspaceDir}/**/*.md`, {
    ignoreInitial: true,
    persistent: true,
    usePolling: process.env.NODE_ENV === "test",
    interval: 50,
    ignored: (absolutePath: string) => {
      const relative = toRelative(absolutePath);
      if (relative === "" || relative === ".") return false;
      return ig.ignores(relative);
    },
  });

  const readAndEmit = async (
    type: "add" | "change",
    absolute: string
  ): Promise<void> => {
    const content = await fsp.readFile(absolute, "utf8").catch(() => undefined);
    if (content === undefined) return;
    emit({ type, relativePath: toRelative(absolute), content });
  };

  watcher.on("add", (absolute) => {
    readAndEmit("add", absolute);
  });
  watcher.on("change", (absolute) => {
    readAndEmit("change", absolute);
  });
  watcher.on("unlink", (absolute) => {
    emit({ type: "unlink", relativePath: toRelative(absolute) });
  });

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", resolve);
  });

  return { ready, close: () => watcher.close() };
}
