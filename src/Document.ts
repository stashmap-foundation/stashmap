import { extractImportedFrontMatter } from "./markdownFrontMatter";
import { ensureKnowstrDocIdFrontMatter } from "./knowstrFrontmatter";

export type Document = {
  author: PublicKey;
  docId: string;
  updatedMs: number;
  content: string;
  filePath?: string;
};

export type DocumentDelete = {
  author: PublicKey;
  docId: string;
  deletedAt: number;
};

export function documentKeyOf(author: PublicKey, docId: string): string {
  return `${author}:${docId}`;
}

export function contentToDocument(
  author: PublicKey,
  content: string,
  filePath?: string
): Document {
  const { frontMatter } = extractImportedFrontMatter(content);
  const { docId } = ensureKnowstrDocIdFrontMatter(frontMatter);
  return {
    author,
    docId,
    updatedMs: Date.now(),
    content,
    ...(filePath !== undefined && { filePath }),
  };
}
