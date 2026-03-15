import fs from "fs/promises";
import path from "path";
import { Event } from "nostr-tools";
import { findTag } from "../nostrEvents";
import { joinID } from "../connections";
import { parseMarkdownHierarchy } from "../markdownTree";

export const DOCUMENTS_DIR = "DOCUMENTS";
export const BASELINE_DIR = "base";

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
    .replace(/\s+\{.*\}\s*$/, "")
    .trim();
  return heading || "document";
}

function editingHeaderLines(
  author: PublicKey,
  dTag: string
): readonly string[] {
  const rootRelationId = joinID(author, dTag);
  return [
    `<!-- ks:root=${dTag} sourceAuthor=${author} sourceRoot=${rootRelationId} sourceRelation=${rootRelationId} -->`,
    [
      "<!-- ks:editing",
      "Markers:",
      "- (!) relevant",
      "- (?) maybe_relevant",
      "- (~) little_relevant",
      "- (x) not_relevant",
      "- (+) confirms",
      "- (-) contra",
      "",
      "Rules:",
      "- Preserve existing ks:id marker lines when moving or renaming rows.",
      "- Never invent ks:id markers for new rows; write new rows as plain markdown without ks:id.",
      "- Never edit ks metadata lines by hand.",
      '- To delete, move the row with its marker into the final "# Delete" root.',
      '- Keep "# Delete" as the last root.',
      "- push will reject lost, duplicated, or invented markers.",
      "-->",
    ].join("\n"),
  ] as const;
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

export function ensureEditableDocumentHeader(
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
  if (contentWithDeleteSection.includes("<!-- ks:root=")) {
    return contentWithDeleteSection;
  }

  return `${[
    ...editingHeaderLines(author, dTag),
    "",
    contentWithDeleteSection,
  ].join("\n")}`;
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
  const titleSlug = slugify(getDocumentTitle(content));
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
  const match = content.match(/<!-- ks:root=(\S+)/);
  return match?.[1];
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
