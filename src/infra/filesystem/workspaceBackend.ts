import path from "path";
import fs from "fs/promises";
import {
  ScannedWorkspaceDocument,
  scanWorkspaceDocuments,
  WorkspaceSaveProfile,
} from "./workspaceScan";
import type { Document } from "../../core/Document";
import {
  ensureKnowstrDocId,
  serializeFrontMatter,
} from "../../core/knowstrFrontmatter";

export async function loadWorkspaceAsDocuments(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<ScannedWorkspaceDocument>> {
  const { documents } = await scanWorkspaceDocuments(profile);
  return documents;
}

export function buildWorkspaceDocumentContent(
  content: string,
  docId: string
): string {
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "");
  const { frontMatter } = ensureKnowstrDocId({ knowstr_doc_id: docId });
  return `${serializeFrontMatter(frontMatter)}${stripped}`;
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
      await fs.writeFile(
        absolute,
        buildWorkspaceDocumentContent(doc.content, doc.docId),
        "utf8"
      );
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
