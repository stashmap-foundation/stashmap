import fs from "fs/promises";
import { buildDocumentEventFromMarkdownTree } from "../../standaloneDocumentEvent";
import { parseMarkdownDocument } from "../../core/markdownTree";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  collectNodeIds,
  parseWorkspaceDocumentRoots,
  scanWorkspaceDocuments,
} from "./workspaceScan";

type NormalizedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  docId: string;
  normalizedContent: string;
  activeNodeIds: string[];
  changed: boolean;
};

function findDuplicateIds(values: string[]): string[] {
  const counts = values.reduce(
    (acc, value) => ({
      ...acc,
      [value]: (acc[value] || 0) + 1,
    }),
    {} as Record<string, number>
  );

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function normalizeWorkspaceDocument(
  profile: WorkspaceSaveProfile,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  const rootTree = {
    ...document.mainRoot,
    frontMatter: document.frontMatter,
  };

  const builtEvent = buildDocumentEventFromMarkdownTree(
    profile.pubkey,
    rootTree
  );
  const normalizedContent = builtEvent.event.content;
  const normalizedParsed = parseMarkdownDocument(normalizedContent);
  const normalizedRoot = parseWorkspaceDocumentRoots(
    normalizedParsed.tree,
    normalizedParsed.title,
    document.frontMatter,
    document.relativePath
  );
  const activeNodeIds = collectNodeIds(normalizedRoot);

  return {
    filePath: document.filePath,
    relativePath: document.relativePath,
    docId: document.docId,
    normalizedContent,
    activeNodeIds,
    changed: document.currentContent !== normalizedContent,
  };
}

function collectAllNodeIds(documents: NormalizedWorkspaceDocument[]): string[] {
  return documents.flatMap((document) => document.activeNodeIds);
}

function validateWorkspaceIntegrity(
  normalizedDocuments: NormalizedWorkspaceDocument[]
): void {
  const docIdCounts = normalizedDocuments.reduce(
    (acc, document) => ({
      ...acc,
      [document.docId]: (acc[document.docId] || 0) + 1,
    }),
    {} as Record<string, number>
  );
  const duplicateDocIds = Object.entries(docIdCounts)
    .filter(([, count]) => count > 1)
    .map(([docId]) => docId)
    .sort();

  if (duplicateDocIds.length > 0) {
    throw new Error(
      `Workspace contains duplicate knowstr_doc_id values: ${duplicateDocIds.join(
        ", "
      )}`
    );
  }

  const allNodeIds = collectAllNodeIds(normalizedDocuments);
  const duplicateNodeIds = findDuplicateIds(allNodeIds);
  if (duplicateNodeIds.length > 0) {
    throw new Error(
      `Workspace contains duplicate node ids: ${duplicateNodeIds.join(", ")}`
    );
  }
}

export type WorkspaceWrite = {
  filePath: string;
  content: string;
};

export async function applyWorkspaceChanges(
  writes: ReadonlyArray<WorkspaceWrite>,
  deletions: ReadonlyArray<string> = []
): Promise<{ changed_paths: string[]; removed_paths: string[] }> {
  await Promise.all([
    ...writes.map((write) =>
      fs.writeFile(write.filePath, write.content, "utf8")
    ),
    ...deletions.map((filePath) => fs.unlink(filePath)),
  ]);
  return {
    changed_paths: writes.map((write) => write.filePath),
    removed_paths: [...deletions],
  };
}

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  changed_paths: string[];
}> {
  const scannedDocuments = await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(profile, document)
  );
  validateWorkspaceIntegrity(normalizedDocuments);

  const writes = normalizedDocuments
    .filter((document) => document.changed)
    .map((document) => ({
      filePath: document.filePath,
      content: document.normalizedContent,
    }));

  const result = await applyWorkspaceChanges(writes);
  return { changed_paths: result.changed_paths };
}
