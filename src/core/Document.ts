import { ensureKnowstrDocIdFrontMatter } from "./knowstrFrontmatter";
import { extractTitle } from "./markdownFrontMatter";
import { parseMarkdownDocument, MarkdownTreeNode } from "./markdownTree";
import { spansText } from "./nodeSpans";
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

function firstTopLevelNodeText(tree: MarkdownTreeNode[]): string | undefined {
  const root = tree.find((node) => !node.hidden);
  if (!root) return undefined;
  const text = spansText(root.spans);
  return text || undefined;
}

export function contentToDocument(
  author: PublicKey,
  content: string,
  filePath?: string,
  fallbackTitle?: string
): Document {
  const { tree, frontMatter } = parseMarkdownDocument(content);
  const { docId } = ensureKnowstrDocIdFrontMatter(frontMatter);
  const systemRole = systemRoleFromFilePath(filePath);
  const frontMatterTitle = frontMatter ? extractTitle(frontMatter) : undefined;
  const title =
    frontMatterTitle ??
    fallbackTitle ??
    firstTopLevelNodeText(tree) ??
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
