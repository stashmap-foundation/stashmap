import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { finalizeEvent } from "nostr-tools";
import { LOCAL } from "../../core/nodeRef";
import { useBackend } from "../../BackendContext";
import { useDocumentStore } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentWrites, Plan } from "../../planner";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  fileNameTitle,
  parseToDocument,
} from "../../core/Document";
import { isUserLoggedInWithSeed } from "../../NostrAuthContext";
import { buildDepositEvent } from "../../nodesDocumentEvent";
import type { WorkspaceConfig } from "../../workspaceConfig";
import type { WritePublisher } from "./writeSupport";

function parsedWrite(write: {
  document: Document;
  content: string;
}): ParsedDocument {
  const parsed = parseToDocument(LOCAL, write.content, {
    path: write.document.docId,
    fallbackTitle: fileNameTitle(write.document.docId),
    updatedMsOverride: Date.now(),
    ...(write.document.systemRole !== undefined
      ? { systemRoleOverride: write.document.systemRole }
      : {}),
  });
  return { document: parsed.document, nodes: parsed.nodes };
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
    const deletions = plan.deletedDocs.toArray().map(
      (docId): DocumentDelete => ({
        sourceId: LOCAL,
        docId,
        deletedAt: Date.now(),
      })
    );

    if (writes.length === 0 && deletions.length === 0) return;

    const saveMs = Date.now();
    const parsedWrites = writes.map((write) => ({
      parsed: parsedWrite(write),
      content: write.content,
    }));

    if (store) {
      parsedWrites.forEach((write) => store.upsertDocument(write.parsed));
      deletions.forEach((del) => store.deleteDocument(del));
    }

    if (workspace) {
      await workspace.save(
        parsedWrites.map((write) => ({
          relativePath: write.parsed.document.docId,
          content: write.content,
        })),
        deletions.map((del) => del.docId)
      );
      const { workspaceConfig, user } = backend;
      if (workspaceConfig && user) {
        const publishResults = (
          await Promise.all(
            parsedWrites.map((write) =>
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
