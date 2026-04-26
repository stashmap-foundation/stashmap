import { MarkdownTreeNode, parseMarkdownHierarchy } from "./markdownTree";
import { extractImportedFrontMatter } from "./markdownFrontMatter";
import { plainSpans, spansText } from "./nodeSpans";

export type MarkdownImportFile = {
  name: string;
  markdown: string;
};

export type MarkdownImportMetadata = {
  title?: string;
};

function looksLikeYamlMetadataNode(node: MarkdownTreeNode): boolean {
  return (
    /^[A-Za-z0-9_-]+:\s*.*$/u.test(spansText(node.spans)) &&
    (node.blockKind === "paragraph" ||
      node.blockKind === "list_item" ||
      node.blockKind === "heading" ||
      node.blockKind === undefined)
  );
}

export function dropLeadingYamlEchoRoots(
  roots: MarkdownTreeNode[],
  frontMatter?: string
): MarkdownTreeNode[] {
  if (!frontMatter) {
    return roots;
  }

  const firstContentIndex = roots.findIndex(
    (root) => !looksLikeYamlMetadataNode(root)
  );
  if (firstContentIndex <= 0) {
    return roots;
  }
  return roots.slice(firstContentIndex);
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/u, "").trim();
  if (baseName) {
    return baseName;
  }
  return "Imported Markdown";
}

export function extractMarkdownImportPayload(markdown: string): {
  body: string;
  frontMatter?: string;
  metadata: MarkdownImportMetadata;
} {
  return extractImportedFrontMatter(markdown);
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

function attachFrontMatter(
  roots: MarkdownTreeNode[],
  frontMatter?: string
): MarkdownTreeNode[] {
  if (!frontMatter || roots.length === 0) {
    return roots;
  }

  const [firstRoot, ...rest] = roots;
  if (!firstRoot) {
    return roots;
  }

  return [
    {
      ...firstRoot,
      frontMatter,
    },
    ...rest,
  ];
}

export function parseMarkdownImportFiles(
  files: MarkdownImportFile[]
): MarkdownTreeNode[] {
  return files.reduce((acc: MarkdownTreeNode[], file: MarkdownImportFile) => {
    const { body, frontMatter, metadata } = extractMarkdownImportPayload(
      file.markdown
    );
    const roots = dropLeadingYamlEchoRoots(
      parseMarkdownHierarchy(body),
      frontMatter
    );
    const normalizedRoots = attachFrontMatter(
      normalizeRootsForSingleFile(roots, file.name, metadata),
      frontMatter
    );
    return [...acc, ...normalizedRoots];
  }, []);
}
