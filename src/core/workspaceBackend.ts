import path from "path";
import fs from "fs/promises";
import { scanWorkspaceDocuments, WorkspaceSaveProfile } from "./workspaceSave";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import { getEventMs } from "../nostrEvents";
import type { Document } from "../DocumentStore";

export async function loadWorkspaceAsDocuments(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<Document>> {
  const scanned = await scanWorkspaceDocuments(profile);
  return scanned.map((doc) => {
    const rootTree = {
      ...doc.mainRoot,
      frontMatter: doc.frontMatter,
      filePath: doc.relativePath,
    };
    const { event, rootUuid } = buildDocumentEventFromMarkdownTree(
      profile.pubkey,
      rootTree
    );
    return {
      author: profile.pubkey,
      dTag: rootUuid,
      updatedMs: getEventMs(event),
      content: event.content,
      filePath: doc.relativePath,
    };
  });
}

export async function saveDocumentsToWorkspace(
  profile: WorkspaceSaveProfile,
  documents: ReadonlyArray<Document>,
  deletedPaths: ReadonlyArray<string> = []
): Promise<{ changed_paths: string[]; removed_paths: string[] }> {
  const relevant = documents.filter(
    (doc) => doc.author === profile.pubkey && doc.filePath !== undefined
  );

  const writeResults = await Promise.all(
    relevant.map(async (doc) => {
      const absolute = path.join(profile.workspaceDir, doc.filePath as string);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, doc.content, "utf8");
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
