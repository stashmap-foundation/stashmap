import React, { Dispatch, SetStateAction } from "react";
import { UnsignedEvent } from "nostr-tools";
import { useBackend } from "../../BackendContext";
import { useDocumentStore } from "../../DocumentStore";
import { useData } from "../../DataContext";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, Plan } from "../../planner";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";
import { eventToDocument, eventToDocumentDelete } from "../../nostrEvents";
import { Document, DocumentDelete } from "../../Document";
import { extractImportedFrontMatter } from "../../markdownFrontMatter";

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

function uniqueSlugPath(baseSlug: string, taken: ReadonlySet<string>): string {
  const candidate = (suffix: number): string =>
    suffix === 1 ? `${baseSlug}.md` : `${baseSlug}-${suffix}.md`;
  const firstFree = (suffix: number): string =>
    taken.has(candidate(suffix)) ? firstFree(suffix + 1) : candidate(suffix);
  return firstFree(1);
}

function collectTakenPaths(knowledgeDBs: KnowledgeDBs): Set<string> {
  const paths = new Set<string>();
  knowledgeDBs.forEach((db) => {
    db.nodes.forEach((node) => {
      if (!node.parent && node.filePath) {
        paths.add(node.filePath);
      }
    });
  });
  return paths;
}

function lookupFilePath(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  dTag: string
): string | undefined {
  return knowledgeDBs.get(author)?.nodes.get(dTag)?.filePath;
}

function enrichWithFilePath(
  event: UnsignedEvent,
  knowledgeDBs: KnowledgeDBs,
  taken: Set<string>
): Document | undefined {
  const base = eventToDocument(event);
  if (!base) return undefined;
  const existing = lookupFilePath(knowledgeDBs, base.author, base.dTag);
  const filePath =
    existing ??
    uniqueSlugPath(
      slugify(extractRootTitle(event.content) ?? base.dTag),
      taken
    );
  // eslint-disable-next-line functional/immutable-data
  taken.add(filePath);
  return { ...base, filePath };
}

function enrichDelete(
  event: UnsignedEvent,
  knowledgeDBs: KnowledgeDBs
): { del: DocumentDelete; filePath?: string } | undefined {
  const del = eventToDocumentDelete(event);
  if (!del) return undefined;
  return {
    del,
    filePath: lookupFilePath(knowledgeDBs, del.author, del.dTag),
  };
}

export function FilesystemExecutorProvider({
  setPublishEvents,
  setPanes,
  setViews,
  children,
}: {
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
  children: React.ReactNode;
}): JSX.Element {
  const store = useDocumentStore();
  const { knowledgeDBs } = useData();
  const { workspace } = useBackend();

  const executePlan = async (plan: Plan): Promise<void> => {
    setPanes(plan.panes);
    setViews(plan.views);
    const filteredEvents = buildDocumentEvents(plan);

    setPublishEvents((prevStatus) => ({
      ...prevStatus,
      temporaryView: plan.temporaryView,
      temporaryEvents: prevStatus.temporaryEvents.concat(plan.temporaryEvents),
    }));

    if (filteredEvents.size === 0) return;

    const writable = filteredEvents
      .filter(
        (event) =>
          event.kind === KIND_KNOWLEDGE_DOCUMENT || event.kind === KIND_DELETE
      )
      .toArray();

    if (writable.length === 0) return;

    const taken = collectTakenPaths(knowledgeDBs);
    const documentsToWrite = writable
      .map((event) => enrichWithFilePath(event, knowledgeDBs, taken))
      .filter((doc): doc is Document => doc !== undefined);

    const deletions = writable
      .map((event) => enrichDelete(event, knowledgeDBs))
      .filter(
        (item): item is { del: DocumentDelete; filePath?: string } =>
          item !== undefined
      );

    if (store) {
      documentsToWrite.forEach((doc) => store.upsertDocument(doc));
      deletions.forEach(({ del }) => store.deleteDocument(del));
    }

    if (workspace) {
      const deletedPaths = deletions
        .map((item) => item.filePath)
        .filter((p): p is string => p !== undefined);
      await workspace.save(documentsToWrite, deletedPaths);
    }
  };

  const republishEventsOnRelay = (): Promise<void> => Promise.resolve();

  return (
    <ExecutorProvider
      executor={{
        executePlan,
        republishEvents: republishEventsOnRelay,
      }}
    >
      {children}
    </ExecutorProvider>
  );
}
