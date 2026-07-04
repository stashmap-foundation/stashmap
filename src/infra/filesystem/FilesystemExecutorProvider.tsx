import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../../core/nodeRef";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentWrites, Plan } from "../../planner";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
  parseToDocument,
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
  docId: string
): string | undefined {
  return documents.get(documentKeyOf(LOCAL, docId))?.filePath;
}

type EnrichedWrite = {
  parsed: ParsedDocument;
  filePath: string;
  content: string;
};

function enrichWithFilePath(
  write: { document: Document; content: string },
  documents: ImmutableMap<string, Document>,
  taken: ReadonlySet<string>
): EnrichedWrite {
  const existing = lookupFilePath(documents, write.document.docId);
  const filePath =
    write.document.systemRole === "log"
      ? LOG_ROOT_FILE
      : existing ??
        uniqueSlugPath(
          slugify(write.document.title || write.document.docId),
          taken
        );
  // Same title rule as the initial load (workspaceScan): on a file
  // workspace the filename is the identity, so it beats content-derived
  // titles. Without this, the first save silently renamed the document.
  const filePathParts = filePath.split("/");
  const fallbackTitle =
    filePathParts[filePathParts.length - 1]?.replace(/\.md$/u, "") || undefined;
  const parsed = parseToDocument(LOCAL, write.content, {
    updatedMsOverride: Date.now(),
    docIdFallback: write.document.docId,
    ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
    ...(write.document.systemRole !== undefined
      ? { systemRoleOverride: write.document.systemRole }
      : {}),
  });
  return {
    parsed: {
      document: { ...parsed.document, filePath },
      nodes: parsed.nodes,
    },
    filePath,
    content: write.content,
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
    if (plan.paneUpdate) {
      setPanes(plan.panes);
    }
    setViews(plan.views);

    setPublishEvents((prevStatus) => ({
      ...prevStatus,
      temporaryView: plan.temporaryView,
      temporaryEvents: prevStatus.temporaryEvents.concat(plan.temporaryEvents),
    }));

    const writes = buildDocumentWrites(plan);
    const deletions = plan.deletedDocs
      .toArray()
      .map((docId): { del: DocumentDelete; filePath?: string } => ({
        del: { sourceId: LOCAL, docId, deletedAt: Date.now() },
        filePath: lookupFilePath(documents, docId),
      }));

    if (writes.length === 0 && deletions.length === 0) return;

    const enriched = writes.reduce<{
      items: EnrichedWrite[];
      taken: ReadonlySet<string>;
    }>(
      (acc, write) => {
        const result = enrichWithFilePath(write, documents, acc.taken);
        return {
          items: [...acc.items, result],
          taken: new Set([...acc.taken, result.filePath]),
        };
      },
      { items: [], taken: collectTakenPaths(documents) }
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
