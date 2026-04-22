import path from "path";
import { UnsignedEvent } from "nostr-tools";
import {
  applyWorkspaceChanges,
  ensureKnowstrDocIdFrontMatter,
  scanWorkspaceDocuments,
  WorkspaceSaveProfile,
} from "./workspaceSave";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../nostr";

export async function loadWorkspaceAsEvents(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<UnsignedEvent>> {
  const documents = await scanWorkspaceDocuments(profile);
  return documents.map((document) => {
    const rootTree = {
      ...document.mainRoot,
      frontMatter: document.frontMatter,
    };
    return buildDocumentEventFromMarkdownTree(profile.pubkey, rootTree).event;
  });
}

function extractDocIdFromDocument(event: UnsignedEvent): string | undefined {
  return event.tags.find((tag) => tag[0] === "d")?.[1];
}

function extractDocIdFromDelete(event: UnsignedEvent): string | undefined {
  const aTag = event.tags.find((tag) => tag[0] === "a")?.[1];
  if (!aTag) return undefined;
  const parts = aTag.split(":");
  if (parts.length < 3) return undefined;
  return parts.slice(2).join(":");
}

function extractRootTitle(content: string): string | undefined {
  const withoutFrontMatter = content.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u,
    ""
  );
  const match = withoutFrontMatter.match(/^#{1,6}\s+(.+?)\s*$/mu);
  if (!match?.[1]) return undefined;
  return match[1].replace(/<!--.*?-->/gu, "").trim();
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/<!--.*?-->/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
  return slug.length > 0 ? slug : "document";
}

function ensureFrontMatter(content: string, docId: string): string {
  if (/^---\r?\n[\s\S]*?knowstr_doc_id:\s*\S+[\s\S]*?\r?\n---/u.test(content)) {
    return content;
  }
  const { frontMatter } = ensureKnowstrDocIdFrontMatter(
    `knowstr_doc_id: ${docId}`
  );
  const withoutExistingFrontMatter = content.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u,
    ""
  );
  return `${frontMatter}\n${withoutExistingFrontMatter}`;
}

function uniqueFilePath(
  workspaceDir: string,
  baseSlug: string,
  taken: ReadonlySet<string>
): string {
  const candidate = (suffix: number): string =>
    path.join(
      workspaceDir,
      suffix === 1 ? `${baseSlug}.md` : `${baseSlug}-${suffix}.md`
    );
  const firstFree = (suffix: number): string =>
    taken.has(candidate(suffix)) ? firstFree(suffix + 1) : candidate(suffix);
  return firstFree(1);
}

type WriteTarget = {
  docId: string;
  filePath: string;
  content: string;
};

type PlannedTargets = {
  writes: ReadonlyArray<WriteTarget>;
  deletes: ReadonlyArray<string>;
};

function planTargets(
  profile: WorkspaceSaveProfile,
  events: ReadonlyArray<UnsignedEvent>,
  initialDocIdToPath: ReadonlyMap<string, string>,
  initialPaths: ReadonlySet<string>
): PlannedTargets {
  const relevantEvents = events.filter(
    (event) =>
      event.pubkey === profile.pubkey &&
      (event.kind === KIND_KNOWLEDGE_DOCUMENT || event.kind === KIND_DELETE)
  );

  return relevantEvents.reduce<PlannedTargets>(
    (state, event) => {
      const docIdToPath = new Map<string, string>([
        ...initialDocIdToPath,
        ...state.writes.map((write) => [write.docId, write.filePath] as const),
      ]);
      const taken = new Set<string>([
        ...Array.from(initialPaths).filter(
          (filePath) => !state.deletes.includes(filePath)
        ),
        ...state.writes.map((write) => write.filePath),
      ]);

      if (event.kind === KIND_KNOWLEDGE_DOCUMENT) {
        const docId = extractDocIdFromDocument(event);
        if (!docId) return state;
        const existingPath = docIdToPath.get(docId);
        const content = ensureFrontMatter(event.content, docId);
        const title = extractRootTitle(event.content);
        const filePath =
          existingPath ??
          uniqueFilePath(profile.workspaceDir, slugify(title ?? docId), taken);
        return {
          ...state,
          writes: [...state.writes, { docId, filePath, content }],
        };
      }

      const docId = extractDocIdFromDelete(event);
      if (!docId) return state;
      const existingPath = docIdToPath.get(docId);
      if (!existingPath) return state;
      return {
        ...state,
        deletes: [...state.deletes, existingPath],
      };
    },
    { writes: [], deletes: [] }
  );
}

export async function saveEventsToWorkspace(
  profile: WorkspaceSaveProfile,
  events: ReadonlyArray<UnsignedEvent>
): Promise<{ changed_paths: string[]; removed_paths: string[] }> {
  const scanned = await scanWorkspaceDocuments(profile);
  const initialDocIdToPath = new Map(
    scanned.map((document) => [document.docId, document.filePath])
  );
  const initialPaths = new Set(scanned.map((document) => document.filePath));

  const { writes, deletes } = planTargets(
    profile,
    events,
    initialDocIdToPath,
    initialPaths
  );

  return applyWorkspaceChanges(writes, deletes);
}
