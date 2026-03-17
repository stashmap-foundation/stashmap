import fs from "fs/promises";
import path from "path";
import { Event } from "nostr-tools";
import { findTag } from "../nostrEvents";
import { joinID } from "../../graph/context";
import { parseMarkdownHierarchy } from "../markdownTree";

export const DOCUMENTS_DIR = "DOCUMENTS";
const BASELINE_DIR = "base";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

function getDocumentTitle(content: string): string {
  const heading = content
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .replace(/\s*<!--.*-->\s*$/, "")
    .trim();
  return heading || "document";
}

function editingFrontMatter(author: PublicKey, dTag: string): string {
  const rootNodeId = joinID(author, dTag);
  return [
    "---",
    `root: ${dTag}`,
    `author: ${author}`,
    `sourceRoot: ${rootNodeId}`,
    `sourceNode: ${rootNodeId}`,
    "editing: |",
    "  Edit text freely. Never modify <!-- id:... --> comments.",
    "  Never add <!-- id:... --> to new items. Push will reject invented IDs.",
    "  Markers: (!) relevant (?) maybe relevant (~) little relevant (x) not relevant (+) confirms (-) contra",
    '  Delete: move lines with their comments under "# Delete"',
    "  Push changes with: knowstr push",
    "---",
  ].join("\n");
}

function hasDeleteHeadingSection(content: string): boolean {
  const roots = parseMarkdownHierarchy(content).filter((root) => !root.hidden);
  const deleteRoot = roots[1];
  return (
    roots.length >= 2 &&
    deleteRoot?.text === "Delete" &&
    deleteRoot.blockKind === "heading" &&
    deleteRoot.headingLevel === 1
  );
}

function ensureDeleteHeadingSection(content: string): string {
  if (hasDeleteHeadingSection(content)) {
    return content.endsWith("\n") ? content : `${content}\n`;
  }

  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  return `${normalizedContent}\n# Delete\n`;
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function stripFrontMatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) {
    return content;
  }
  return content.slice(match[0].length);
}

function ensureEditableDocumentHeader(
  content: string,
  author: PublicKey,
  dTag: string,
  options?: {
    includeDeleteSection?: boolean;
  }
): string {
  const contentWithDeleteSection =
    options?.includeDeleteSection === false
      ? ensureTrailingNewline(content)
      : ensureDeleteHeadingSection(content);
  if (contentWithDeleteSection.startsWith("---\n")) {
    return contentWithDeleteSection;
  }

  return `${editingFrontMatter(author, dTag)}\n\n${contentWithDeleteSection}`;
}

export function baselinePath(
  knowstrHome: string,
  author: PublicKey,
  dTag: string
): string {
  return path.join(knowstrHome, BASELINE_DIR, author, `${dTag}.md`);
}

function workspaceFilePath(
  workspaceDir: string,
  author: PublicKey,
  content: string
): string {
  const titleSlug = slugify(getDocumentTitle(stripFrontMatter(content)));
  return path.join(workspaceDir, DOCUMENTS_DIR, author, `${titleSlug}.md`);
}

export async function removeWorkspaceFileIfExists(
  filePath: string
): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    /* ignore cleanup errors */
  }
}

export function extractDTagFromHeader(content: string): string | undefined {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return undefined;
  }
  const rootMatch = fmMatch[1].match(/^root:\s*(.+)$/m);
  return rootMatch?.[1].trim();
}

export async function findWorkspaceFileByDTag(
  workspaceDir: string,
  author: PublicKey,
  dTag: string
): Promise<string | undefined> {
  const authorDir = path.join(workspaceDir, DOCUMENTS_DIR, author);
  try {
    const files = await fs.readdir(authorDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const results = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(authorDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const fileDTag = extractDTagFromHeader(content);
        return fileDTag === dTag ? filePath : undefined;
      })
    );
    return results.find((result): result is string => result !== undefined);
  } catch {
    return undefined;
  }
}

export async function writeDocumentFiles(
  workspaceDir: string,
  knowstrHome: string,
  event: Event
): Promise<{ workspacePath: string; baselinePath: string } | undefined> {
  const dTag = findTag(event, "d");
  if (!dTag) {
    return undefined;
  }

  const author = event.pubkey as PublicKey;
  const editableContent = ensureEditableDocumentHeader(
    event.content,
    author,
    dTag
  );

  const existingWorkspacePath = await findWorkspaceFileByDTag(
    workspaceDir,
    author,
    dTag
  );
  const wsPath = workspaceFilePath(workspaceDir, author, editableContent);

  if (existingWorkspacePath && existingWorkspacePath !== wsPath) {
    await removeWorkspaceFileIfExists(existingWorkspacePath);
  }

  await fs.mkdir(path.dirname(wsPath), { recursive: true });
  await fs.writeFile(wsPath, editableContent, "utf8");

  const basePath = baselinePath(knowstrHome, author, dTag);
  await fs.mkdir(path.dirname(basePath), { recursive: true });
  await fs.writeFile(basePath, editableContent, "utf8");

  return { workspacePath: wsPath, baselinePath: basePath };
}

export async function readBaselineContent(
  knowstrHome: string,
  author: PublicKey,
  dTag: string
): Promise<string | undefined> {
  try {
    return await fs.readFile(baselinePath(knowstrHome, author, dTag), "utf8");
  } catch {
    return undefined;
  }
}

export async function isLocallyEdited(
  workspacePath: string,
  baselineContent: string
): Promise<boolean> {
  try {
    const workspaceContent = await fs.readFile(workspacePath, "utf8");
    return workspaceContent !== baselineContent;
  } catch {
    return false;
  }
}
