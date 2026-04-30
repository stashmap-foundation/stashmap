import { MarkdownTreeNode, parseMarkdown } from "./markdownTree";
import { plainSpans } from "./nodeSpans";

export type MarkdownImportFile = {
  name: string;
  markdown: string;
};

export type MarkdownImportMetadata = {
  title?: string;
};

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/u, "").trim();
  if (baseName) {
    return baseName;
  }
  return "Imported Markdown";
}

function normalizeRootsForSingleFile(
  roots: MarkdownTreeNode[],
  fileName: string,
  metadata: MarkdownImportMetadata
): MarkdownTreeNode[] {
  if (roots.length === 0) {
    return [];
  }

  if (
    roots.length === 1 &&
    (!metadata.title || roots[0]?.blockKind === "heading")
  ) {
    return roots;
  }

  return [
    {
      spans: plainSpans(metadata.title || titleFromFileName(fileName)),
      children: roots,
    },
  ];
}

export function parseMarkdownImportFiles(
  files: MarkdownImportFile[]
): MarkdownTreeNode[] {
  return files.reduce((acc: MarkdownTreeNode[], file: MarkdownImportFile) => {
    const { tree, frontMatter } = parseMarkdown(file.markdown);
    const title =
      typeof frontMatter?.title === "string"
        ? (frontMatter.title as string)
        : undefined;
    return [...acc, ...normalizeRootsForSingleFile(tree, file.name, { title })];
  }, []);
}
