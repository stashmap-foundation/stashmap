import { MarkdownTreeNode, parseMarkdown } from "./markdownTree";

export type MarkdownImportFile = {
  name: string;
  markdown: string;
};

export function parseMarkdownImportFiles(
  files: MarkdownImportFile[]
): MarkdownTreeNode[] {
  return files.reduce((acc: MarkdownTreeNode[], file: MarkdownImportFile) => {
    const { tree } = parseMarkdown(file.markdown);
    return [...acc, ...tree];
  }, []);
}
