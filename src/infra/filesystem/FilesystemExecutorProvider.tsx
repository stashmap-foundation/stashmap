import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, Plan } from "../../planner";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";
import { eventToDocument, eventToDocumentDelete } from "../../nostrEvents";
import { Document, DocumentDelete, documentKeyOf } from "../../core/Document";
import { extractImportedFrontMatter } from "../../core/markdownFrontMatter";
import { LOG_ROOT_FILE } from "../../core/systemRoots";

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

function collectTakenPaths(
  documents: ImmutableMap<string, Document>
): Set<string> {
  const paths = new Set<string>();
  documents.forEach((doc) => {
    if (doc.filePath) paths.add(doc.filePath);
  });
  return paths;
}

function lookupFilePath(
  documents: ImmutableMap<string, Document>,
  author: PublicKey,
  docId: string
): string | undefined {
  return documents.get(documentKeyOf(author, docId))?.filePath;
}

function enrichWithFilePath(
  event: UnsignedEvent,
  documents: ImmutableMap<string, Document>,
  taken: Set<string>
): Document | undefined {
  const base = eventToDocument(event);
  if (!base) return undefined;
  const existing = lookupFilePath(documents, base.author, base.docId);
  const filePath =
    base.systemRole === "log"
      ? LOG_ROOT_FILE
      : existing ??
        uniqueSlugPath(
          slugify(extractRootTitle(event.content) ?? base.docId),
          taken
        );
  // eslint-disable-next-line functional/immutable-data
  taken.add(filePath);
  return { ...base, filePath };
}

function enrichDelete(
  event: UnsignedEvent,
  documents: ImmutableMap<string, Document>
): { del: DocumentDelete; filePath?: string } | undefined {
  const del = eventToDocumentDelete(event);
  if (!del) return undefined;
  return {
    del,
    filePath: lookupFilePath(documents, del.author, del.docId),
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
  const documents = useDocuments();
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

    const taken = collectTakenPaths(documents);
    const documentsToWrite = writable
      .map((event) => enrichWithFilePath(event, documents, taken))
      .filter((doc): doc is Document => doc !== undefined);

    const deletions = writable
      .map((event) => enrichDelete(event, documents))
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
