import path from "path";
import fs from "fs/promises";
import {
  collectWorkspaceMarkdownFiles,
  ScannedWorkspaceDocument,
  scanWorkspaceDocuments,
  WorkspaceSaveProfile,
} from "./workspaceScan";

export type WorkspaceMarkdownFile = {
  relativePath: string;
  currentContent: string;
};

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

export async function loadWorkspaceFiles(
  profile: Pick<WorkspaceSaveProfile, "workspaceDir">
): Promise<ReadonlyArray<WorkspaceMarkdownFile>> {
  const filePaths = await collectWorkspaceMarkdownFiles(profile.workspaceDir);
  return Promise.all(
    filePaths.map(async (filePath) => ({
      relativePath: path.relative(profile.workspaceDir, filePath),
      currentContent: await fs.readFile(filePath, "utf8"),
    }))
  );
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
