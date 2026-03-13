import fs from "fs/promises";
import path from "path";
import { Event } from "nostr-tools";
import { findTag, getEventMs } from "../nostrEvents";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "../nostr";
import { joinID } from "../connections";
import { parseMarkdownHierarchy } from "../markdownTree";

export const WORKSPACE_VERSION = 2;
export const DOCUMENTS_DIR = "DOCUMENTS";
export const BASELINE_DIR = "base";

export type WorkspaceAuthor = {
  pubkey: PublicKey;
  last_document_created_at: number;
};

export type WorkspaceDocument = {
  replaceable_key: string;
  author: PublicKey;
  event_id: string;
  d_tag: string;
  path: string;
  base_path?: string;
  created_at: number;
  updated_ms: number;
};

export type WorkspaceManifest = {
  workspace_version: number;
  as_user: PublicKey;
  synced_at: string;
  relay_urls: string[];
  contact_pubkeys: PublicKey[];
  authors: WorkspaceAuthor[];
  documents: WorkspaceDocument[];
};

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

function relativeToWorkspace(workspaceDir: string, targetPath: string): string {
  return path.relative(workspaceDir, targetPath).split(path.sep).join("/");
}

function relativeToKnowstrHome(
  knowstrHome: string,
  targetPath: string
): string {
  return path.relative(knowstrHome, targetPath).split(path.sep).join("/");
}

export function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, "manifest.json");
}

function baselineFilePath(knowstrHome: string, documentPath: string): string {
  return path.join(knowstrHome, BASELINE_DIR, documentPath);
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

export async function loadWorkspaceManifest(
  workspaceDir: string
): Promise<WorkspaceManifest | undefined> {
  try {
    const raw = await fs.readFile(manifestPath(workspaceDir), "utf8");
    return JSON.parse(raw) as WorkspaceManifest;
  } catch {
    return undefined;
  }
}

export async function writeWorkspaceManifest(
  workspaceDir: string,
  manifest: WorkspaceManifest
): Promise<void> {
  await fs.writeFile(
    manifestPath(workspaceDir),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

export function createEmptyWorkspaceManifest(
  asUser: PublicKey
): WorkspaceManifest {
  return {
    workspace_version: WORKSPACE_VERSION,
    as_user: asUser,
    synced_at: new Date(0).toISOString(),
    relay_urls: [],
    contact_pubkeys: [],
    authors: [],
    documents: [],
  };
}

function toDocumentFilePath(
  workspaceDir: string,
  author: PublicKey,
  dTag: string,
  content: string
): string {
  const safeDTag = slugify(dTag || "document");
  const titleSlug = slugify(getDocumentTitle(content));
  return path.join(
    workspaceDir,
    DOCUMENTS_DIR,
    author,
    `${safeDTag}-${titleSlug}.md`
  );
}

export async function removeWorkspaceFileIfExists(
  filePath: string
): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function writeDocumentFile(
  workspaceDir: string,
  knowstrHome: string | undefined,
  event: Event
): Promise<WorkspaceDocument | undefined> {
  const replaceableKey = getReplaceableKey(event);
  const dTag = findTag(event, "d");
  if (!replaceableKey || !dTag) {
    return undefined;
  }

  const editableContent = ensureEditableDocumentHeader(
    event.content,
    event.pubkey as PublicKey,
    dTag
  );
  const filePath = toDocumentFilePath(
    workspaceDir,
    event.pubkey as PublicKey,
    dTag,
    editableContent
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, editableContent, "utf8");

  const basePath = knowstrHome
    ? baselineFilePath(knowstrHome, relativeToWorkspace(workspaceDir, filePath))
    : undefined;
  if (basePath) {
    await fs.mkdir(path.dirname(basePath), { recursive: true });
    await fs.writeFile(basePath, editableContent, "utf8");
  }

  return {
    replaceable_key: replaceableKey,
    author: event.pubkey as PublicKey,
    event_id: event.id,
    d_tag: dTag,
    path: relativeToWorkspace(workspaceDir, filePath),
    ...(basePath
      ? {
          base_path: relativeToKnowstrHome(knowstrHome as string, basePath),
        }
      : {}),
    created_at: event.created_at,
    updated_ms: getEventMs(event),
  };
}

export function documentMap(
  manifest: WorkspaceManifest | undefined
): Map<string, WorkspaceDocument> {
  return new Map(
    (manifest?.documents || []).map((document) => [
      document.replaceable_key,
      document,
    ])
  );
}

export function authorMap(
  manifest: WorkspaceManifest | undefined
): Map<PublicKey, WorkspaceAuthor> {
  return new Map(
    (manifest?.authors || []).map((author) => [author.pubkey, author])
  );
}

export async function applyDeleteEventsToWorkspaceDocuments(
  workspaceDir: string,
  knowstrHome: string | undefined,
  documents: Map<string, WorkspaceDocument>,
  deleteEvents: Event[]
): Promise<void> {
  await deleteEvents.reduce(async (previous, event) => {
    await previous;
    const replaceableKey = findTag(event, "a");
    const existing = replaceableKey ? documents.get(replaceableKey) : undefined;
    if (
      !replaceableKey ||
      !existing ||
      getEventMs(event) <= existing.updated_ms
    ) {
      return;
    }

    await removeWorkspaceFileIfExists(path.join(workspaceDir, existing.path));
    if (knowstrHome && existing.base_path) {
      await removeWorkspaceFileIfExists(
        path.join(knowstrHome, existing.base_path)
      );
    }
    documents.delete(replaceableKey);
  }, Promise.resolve());
}

export async function applyDocumentEventsToWorkspaceDocuments(
  workspaceDir: string,
  knowstrHome: string | undefined,
  documents: Map<string, WorkspaceDocument>,
  documentEvents: Event[]
): Promise<void> {
  const sortedEvents = [...documentEvents].sort((a, b) => {
    const diff = getEventMs(a) - getEventMs(b);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  await sortedEvents.reduce(async (previous, event) => {
    await previous;
    const replaceableKey = getReplaceableKey(event);
    if (!replaceableKey) {
      return;
    }

    const existing = documents.get(replaceableKey);
    if (existing?.event_id === event.id) {
      return;
    }

    const nextDocument = await writeDocumentFile(
      workspaceDir,
      knowstrHome,
      event
    );
    if (!nextDocument) {
      return;
    }

    if (existing && existing.path !== nextDocument.path) {
      await removeWorkspaceFileIfExists(path.join(workspaceDir, existing.path));
    }
    documents.set(replaceableKey, nextDocument);
  }, Promise.resolve());
}

export function updateAuthorsFromKnowledgeDocumentEvents(
  previousAuthors: Map<PublicKey, WorkspaceAuthor>,
  documentEvents: Event[]
): WorkspaceAuthor[] {
  const authors = new Set<PublicKey>(previousAuthors.keys());
  documentEvents.forEach((event) => {
    authors.add(event.pubkey as PublicKey);
  });

  return [...authors].sort().map((pubkey) => {
    const previous = previousAuthors.get(pubkey);
    const latestCreatedAt = documentEvents
      .filter((event) => event.pubkey === pubkey)
      .reduce(
        (current, event) => Math.max(current, event.created_at),
        previous?.last_document_created_at || 0
      );
    return {
      pubkey,
      last_document_created_at: latestCreatedAt,
    };
  });
}

export async function applyKnowledgeEventsToWorkspace(
  workspaceDir: string,
  knowstrHome: string | undefined,
  baseManifest: WorkspaceManifest,
  events: Event[]
): Promise<WorkspaceManifest> {
  await fs.mkdir(path.join(workspaceDir, DOCUMENTS_DIR), { recursive: true });
  const documents = documentMap(baseManifest);
  const documentEvents = events.filter(
    (event) => event.kind === KIND_KNOWLEDGE_DOCUMENT
  );
  const deleteEvents = events.filter((event) => event.kind === KIND_DELETE);

  await applyDeleteEventsToWorkspaceDocuments(
    workspaceDir,
    knowstrHome,
    documents,
    deleteEvents
  );
  await applyDocumentEventsToWorkspaceDocuments(
    workspaceDir,
    knowstrHome,
    documents,
    documentEvents
  );

  const nextManifest: WorkspaceManifest = {
    ...baseManifest,
    documents: [...documents.values()].sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
    authors: updateAuthorsFromKnowledgeDocumentEvents(
      authorMap(baseManifest),
      documentEvents
    ),
  };

  await writeWorkspaceManifest(workspaceDir, nextManifest);
  return nextManifest;
}

export async function loadOrCreateWorkspaceManifest(
  workspaceDir: string,
  asUser: PublicKey
): Promise<WorkspaceManifest> {
  return (
    (await loadWorkspaceManifest(workspaceDir)) ||
    createEmptyWorkspaceManifest(asUser)
  );
}
