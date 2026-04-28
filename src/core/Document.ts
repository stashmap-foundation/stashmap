import { extractImportedFrontMatter } from "./markdownFrontMatter";
import { ensureKnowstrDocIdFrontMatter } from "./knowstrFrontmatter";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  author: PublicKey;
  docId: string;
  updatedMs: number;
  content: string;
  filePath?: string;
  systemRole?: RootSystemRole;
};

export type DocumentDelete = {
  author: PublicKey;
  docId: string;
  deletedAt: number;
};

export function documentKeyOf(author: PublicKey, docId: string): string {
  return `${author}:${docId}`;
}

export function systemRoleFromFilePath(
  filePath: string | undefined
): RootSystemRole | undefined {
  return filePath === LOG_ROOT_FILE ? LOG_ROOT_ROLE : undefined;
}

export function contentToDocument(
  author: PublicKey,
  content: string,
  filePath?: string
): Document {
  const { frontMatter } = extractImportedFrontMatter(content);
  const { docId } = ensureKnowstrDocIdFrontMatter(frontMatter);
  const systemRole = systemRoleFromFilePath(filePath);
  return {
    author,
    docId,
    updatedMs: Date.now(),
    content,
    ...(filePath !== undefined && { filePath }),
    ...(systemRole !== undefined && { systemRole }),
  };
}
