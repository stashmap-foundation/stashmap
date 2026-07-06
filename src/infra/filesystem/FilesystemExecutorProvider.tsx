import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../../core/nodeRef";
import { useApis } from "../../Apis";
import { isUserLoggedInWithSeed } from "../../NostrAuthContext";
import { useBackend } from "../../BackendContext";
import { useDocumentStore, useDocuments } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDepositEvents, buildDocumentWrites, Plan } from "../../planner";
import {
  snapshotIdForContent,
  snapshotRelativePath,
} from "../../nodesDocumentEvent";
import { publishEventsWithConf, signEvents } from "../nostr/executor";
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
  const backend = useBackend();
  const { workspace } = backend;
  const { finalizeEvent } = useApis();

  // Publication is storage-independent: the workspace lives on disk, but
  // deposits of published documents go to relays here exactly as on the
  // web. Only deposits — the desktop has no storage channel.
  const describeSigningKey = (user: Plan["user"]): string => {
    if (!user) {
      return "no user";
    }
    return isUserLoggedInWithSeed(user)
      ? "seed loaded"
      : "pubkey only — no nsec loaded, cannot sign";
  };

  const publishDeposits = async (plan: Plan): Promise<void> => {
    const deposits = buildDepositEvents(plan);
    // eslint-disable-next-line no-console
    console.log(
      "[publish] deposits built:",
      deposits.size,
      "| key:",
      describeSigningKey(plan.user)
    );
    if (deposits.size === 0) {
      return;
    }
    try {
      const finalized = await signEvents(deposits, plan.user, finalizeEvent);
      // eslint-disable-next-line no-console
      console.log("[publish] signed:", finalized.size);
      if (finalized.size === 0) {
        return;
      }
      const results = await publishEventsWithConf(
        backend,
        plan.relays,
        finalized
      );
      results.forEach((res, id) =>
        res.results.forEach((status, url) =>
          // eslint-disable-next-line no-console
          console.log(
            "[publish]",
            id.slice(0, 8),
            url,
            status.status,
            status.reason ?? ""
          )
        )
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[publish] Publishing deposits failed", error);
    }
  };

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

    // Fork baselines: content-addressed, write-once. Rewriting an existing
    // id is a byte-identical no-op, so no existence check is needed.
    const snapshotWrites = [
      ...new Map(
        writes
          .flatMap((write) => write.snapshotContents)
          .map((content) => [snapshotIdForContent(content), content])
      ),
    ].map(([snapshotId, content]) => ({ snapshotId, content }));

    if (store) {
      enriched.items.forEach((write) => store.upsertDocument(write.parsed));
      deletions.forEach(({ del }) => store.deleteDocument(del));
      store.addSnapshotContents(snapshotWrites);
    }

    if (workspace) {
      const deletedPaths = deletions
        .map((item) => item.filePath)
        .filter((p): p is string => p !== undefined);
      await workspace.save(
        [
          ...enriched.items.map((write) => ({
            relativePath: write.filePath,
            content: write.content,
          })),
          ...snapshotWrites.map((snap) => ({
            relativePath: snapshotRelativePath(snap.snapshotId),
            content: snap.content,
          })),
        ],
        deletedPaths
      );
    }

    await publishDeposits(plan);
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
