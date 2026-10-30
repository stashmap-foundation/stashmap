import fs from "fs/promises";
import path from "path";
import { embeddedTarget } from "../../core/nodeSpans";
import { LOCAL } from "../../core/nodeRef";
import { decodePublicKeyInputSync } from "../nostr/publicKeys";
import { renderDocumentMarkdown } from "../../documentRenderer";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  scanWorkspaceDocuments,
} from "./workspaceScan";

export type SavedWorkspaceDocument = {
  document: ScannedWorkspaceDocument;
  content: string;
  warnings: string[];
};

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

function arrangementWarnings(
  document: ScannedWorkspaceDocument,
  roots: readonly (GraphNode | undefined)[]
): string[] {
  const [folder, ...rest] = document.docId.split("/");
  const author = decodePublicKeyInputSync(folder);
  if (!folder.startsWith("npub1") || !author || rest.length === 0) {
    return [];
  }
  const sourcePath = rest.join("/");
  const target =
    roots.length === 1 ? embeddedTarget(roots[0], LOCAL) : undefined;
  return target?.sourceId === author && target.id === sourcePath
    ? []
    : [
        `${document.docId}: an arrangement must have one root embedding //${folder}/${sourcePath}`,
      ];
}

function documentWarnings(
  knowledgeDBs: KnowledgeDBs,
  document: ScannedWorkspaceDocument
): string[] {
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  const roots = document.topNodeShortIds.map((id) => nodes?.get(id));
  const rootWarnings =
    roots.length === 0
      ? [`${document.docId}: shared documents need a root`]
      : [];
  return [...rootWarnings, ...arrangementWarnings(document, roots)];
}

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  documents: SavedWorkspaceDocument[];
  changed_paths: string[];
  warnings: string[];
}> {
  const { documents: scannedDocuments, knowledgeDBs } =
    await scanWorkspaceDocuments(profile);
  const documents = scannedDocuments.map((document) => ({
    document,
    content: renderDocumentMarkdown(knowledgeDBs, document),
    warnings: documentWarnings(knowledgeDBs, document),
  }));

  const writes = documents
    .filter(({ document, content }) => document.currentContent !== content)
    .map(({ document, content }) => ({
      filePath: path.join(profile.workspaceDir, document.docId),
      content,
    }));

  const result = await applyWorkspaceChanges(writes);
  return {
    documents,
    changed_paths: result.changed_paths,
    warnings: documents.flatMap((entry) => entry.warnings),
  };
}
