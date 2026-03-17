import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";

export type MarkdownImportFile = {
  name: string;
  markdown: string;
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
  fileName: string
): MarkdownTreeNode[] {
  if (roots.length <= 1) {
    return roots;
  }
  return [{ text: titleFromFileName(fileName), children: roots }];
}

export function parseMarkdownImportFiles(
  files: MarkdownImportFile[]
): MarkdownTreeNode[] {
  return files.reduce((acc: MarkdownTreeNode[], file: MarkdownImportFile) => {
    const roots = parseMarkdownHierarchy(file.markdown);
    const normalizedRoots = normalizeRootsForSingleFile(roots, file.name);
    return [...acc, ...normalizedRoots];
  }, []);
}
