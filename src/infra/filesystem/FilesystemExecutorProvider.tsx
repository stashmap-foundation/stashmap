import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { finalizeEvent } from "nostr-tools";
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
import { isUserLoggedInWithSeed } from "../../NostrAuthContext";
import { buildDepositEvent } from "../../nodesDocumentEvent";
import type { WorkspaceConfig } from "../../workspaceConfig";
import type { WritePublisher } from "./writeSupport";

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
      document: {
        ...parsed.document,
        filePath,
        realWorldEntities: write.document.realWorldEntities,
      },
      nodes: parsed.nodes,
    },
    filePath,
    content: write.content,
  };
}

function publishDocument(
  document: Document,
  content: string,
  saveMs: number,
  config: WorkspaceConfig,
  user: User,
  publisher: WritePublisher
): Promise<PublishResultsOfEvent> | undefined {
  if (config.roomRelays.length === 0) {
    return undefined;
  }
  if (!isUserLoggedInWithSeed(user)) {
    throw new Error("Shared filesystem work requires a workspace key");
  }
  const event = finalizeEvent(
    buildDepositEvent(
      document,
      user.publicKey,
      content,
      Math.floor(saveMs / 1000)
    ),
    user.privateKey
  );
  return publisher.publishEvent(config.roomRelays, event);
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
  const backend = useBackend();
  const { workspace } = backend;

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

    const saveMs = Date.now();
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
      const { workspaceConfig, user } = backend;
      if (workspaceConfig && user) {
        const publishResults = (
          await Promise.all(
            enriched.items.map((write) =>
              publishDocument(
                write.parsed.document,
                write.content,
                saveMs,
                workspaceConfig,
                user,
                workspace.publisher
              )
            )
          )
        ).filter(
          (result): result is PublishResultsOfEvent => result !== undefined
        );
        setPublishEvents((current) => ({
          ...current,
          results: publishResults.reduce(
            (results, result) => results.set(result.event.id, result),
            ImmutableMap<string, PublishResultsOfEvent>()
          ),
          isLoading: false,
        }));
      }
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
