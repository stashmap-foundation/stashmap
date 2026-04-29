import { ensureKnowstrDocIdFrontMatter } from "./knowstrFrontmatter";
import { firstTopLevelNodeText, parseMarkdownDocument } from "./markdownTree";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  author: PublicKey;
  docId: string;
  updatedMs: number;
  content: string;
  title: string;
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
  filePath?: string,
  fallbackTitle?: string
): Document {
  const parsed = parseMarkdownDocument(content);
  const { docId } = ensureKnowstrDocIdFrontMatter(parsed.frontMatter);
  const systemRole = systemRoleFromFilePath(filePath);
  const title =
    parsed.title ??
    fallbackTitle ??
    firstTopLevelNodeText(parsed.tree) ??
    "Untitled";
  return {
    author,
    docId,
    updatedMs: Date.now(),
    content,
    title,
    ...(filePath !== undefined && { filePath }),
    ...(systemRole !== undefined && { systemRole }),
  };
}
