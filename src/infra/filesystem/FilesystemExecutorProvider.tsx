import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, Plan } from "../../planner";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";
import { eventToParsed, eventToDocumentDelete } from "../../nostrEvents";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
} from "../../core/Document";
import { LOG_ROOT_FILE } from "../../core/systemRoots";

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
): ReadonlySet<string> {
  return documents.reduce(
    (paths, doc) => (doc.filePath ? new Set([...paths, doc.filePath]) : paths),
    new Set<string>()
  );
}

function lookupFilePath(
  documents: ImmutableMap<string, Document>,
  author: PublicKey,
  docId: string
): string | undefined {
  return documents.get(documentKeyOf(author, docId))?.filePath;
}

type EnrichedWrite = {
  parsed: ParsedDocument;
  filePath: string;
  content: string;
};

function enrichWithFilePath(
  event: UnsignedEvent,
  documents: ImmutableMap<string, Document>,
  taken: ReadonlySet<string>
): EnrichedWrite | undefined {
  const parsed = eventToParsed(event);
  if (!parsed) return undefined;
  const { document } = parsed;
  const existing = lookupFilePath(documents, document.author, document.docId);
  const filePath =
    document.systemRole === "log"
      ? LOG_ROOT_FILE
      : existing ??
        uniqueSlugPath(slugify(document.title || document.docId), taken);
  return {
    parsed: { ...parsed, document: { ...document, filePath } },
    filePath,
    content: event.content,
  };
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

    const enriched = writable.reduce<{
      items: EnrichedWrite[];
      taken: ReadonlySet<string>;
    }>(
      (acc, event) => {
        const result = enrichWithFilePath(event, documents, acc.taken);
        if (!result) return acc;
        return {
          items: [...acc.items, result],
          taken: new Set([...acc.taken, result.filePath]),
        };
      },
      { items: [], taken: collectTakenPaths(documents) }
    );

    const deletions = writable
      .map((event) => enrichDelete(event, documents))
      .filter(
        (item): item is { del: DocumentDelete; filePath?: string } =>
          item !== undefined
      );

    if (store) {
      enriched.items.forEach((write) => store.upsertDocument(write.parsed));
      deletions.forEach(({ del }) => store.deleteDocument(del));
    }

    if (workspace) {
      const deletedPaths = deletions
        .map((item) => item.filePath)
        .filter((p): p is string => p !== undefined);
      await workspace.save(
        enriched.items.map((write) => ({
          relativePath: write.filePath,
          content: write.content,
        })),
        deletedPaths
      );
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
