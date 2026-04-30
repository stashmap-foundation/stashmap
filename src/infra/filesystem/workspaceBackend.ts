import path from "path";
import fs from "fs/promises";
import {
  ScannedWorkspaceDocument,
  scanWorkspaceDocuments,
  WorkspaceSaveProfile,
} from "./workspaceScan";

export type WorkspaceWriteRequest = {
  relativePath: string;
  content: string;
};

export async function loadWorkspaceAsDocuments(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<ScannedWorkspaceDocument>> {
  const { documents } = await scanWorkspaceDocuments(profile);
  return documents;
}

export async function saveDocumentsToWorkspace(
  profile: WorkspaceSaveProfile,
  writes: ReadonlyArray<WorkspaceWriteRequest>,
  deletedPaths: ReadonlyArray<string> = []
): Promise<{ changed_paths: string[]; removed_paths: string[] }> {
  const writeResults = await Promise.all(
    writes.map(async (write) => {
      const absolute = path.join(profile.workspaceDir, write.relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, write.content, "utf8");
      return absolute;
    })
  );
  const removeResults = await Promise.all(
    deletedPaths.map(async (relative) => {
      const absolute = path.join(profile.workspaceDir, relative);
      await fs.unlink(absolute).catch(() => undefined);
      return absolute;
    })
  );

  return {
    changed_paths: writeResults,
    removed_paths: removeResults,
  };
}
