import path from "path";
import fs from "fs/promises";
import { scanWorkspaceDocuments, WorkspaceSaveProfile } from "./workspaceSave";
import type { Document } from "../DocumentStore";
import { ensureKnowstrDocIdFrontMatter } from "../knowstrFrontmatter";

export async function loadWorkspaceAsDocuments(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<Document>> {
  const scanned = await scanWorkspaceDocuments(profile);
  return scanned.map((doc) => ({
    author: profile.pubkey,
    docId: doc.docId,
    updatedMs: Date.now(),
    content: doc.currentContent,
    filePath: doc.relativePath,
  }));
}

function withEnsuredFrontMatter(content: string, docId: string): string {
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "");
  const { frontMatter } = ensureKnowstrDocIdFrontMatter(
    `---\nknowstr_doc_id: ${docId}\n---`
  );
  return `${frontMatter}${stripped}`;
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
        withEnsuredFrontMatter(doc.content, doc.docId),
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
