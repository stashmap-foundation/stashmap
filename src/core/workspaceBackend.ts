import path from "path";
import { UnsignedEvent } from "nostr-tools";
import {
  applyWorkspaceChanges,
  ensureKnowstrDocIdFrontMatter,
  scanWorkspaceDocuments,
  WorkspaceSaveProfile,
} from "./workspaceSave";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import { extractImportedFrontMatter } from "../markdownFrontMatter";
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

function extractNodeIdFromDelete(event: UnsignedEvent): string | undefined {
  const aTag = event.tags.find((tag) => tag[0] === "a")?.[1];
  if (!aTag) return undefined;
  const parts = aTag.split(":");
  if (parts.length < 3) return undefined;
  return parts.slice(2).join(":");
}

function extractRootTitle(content: string): string | undefined {
  const { body } = extractImportedFrontMatter(content);
  const match = body.match(/^#{1,6}\s+(.+?)\s*$/mu);
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

function normalizeFrontMatter(content: string): {
  content: string;
  docId: string;
} {
  const { body, frontMatter: existing } = extractImportedFrontMatter(content);
  const { docId, frontMatter } = ensureKnowstrDocIdFrontMatter(existing);
  return { content: `${frontMatter}${body}`, docId };
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
  initialNodeIdToPath: ReadonlyMap<string, string>,
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
        const { content, docId } = normalizeFrontMatter(event.content);
        const existingPath = docIdToPath.get(docId);
        const title = extractRootTitle(event.content);
        const filePath =
          existingPath ??
          uniqueFilePath(profile.workspaceDir, slugify(title ?? docId), taken);
        return {
          ...state,
          writes: [...state.writes, { docId, filePath, content }],
        };
      }

      const nodeId = extractNodeIdFromDelete(event);
      if (!nodeId) return state;
      const existingPath = initialNodeIdToPath.get(nodeId);
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
  const initialNodeIdToPath = new Map(
    scanned
      .filter((document) => document.mainRoot.uuid)
      .map(
        (document) =>
          [document.mainRoot.uuid as string, document.filePath] as const
      )
  );
  const initialPaths = new Set(scanned.map((document) => document.filePath));

  const { writes, deletes } = planTargets(
    profile,
    events,
    initialDocIdToPath,
    initialNodeIdToPath,
    initialPaths
  );

  return applyWorkspaceChanges(writes, deletes);
}
