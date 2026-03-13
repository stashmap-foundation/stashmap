import fs from "fs/promises";
import path from "path";
import { Event, UnsignedEvent } from "nostr-tools";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import {
  publishSignedEvents,
  resolveWriteRelayUrls,
  signUnsignedEvents,
  loadWriteSecretKey,
  WriteProfile,
  WritePublisher,
} from "./writeSupport";
import {
  applyKnowledgeEventsToWorkspace,
  ensureEditableDocumentHeader,
  loadWorkspaceManifest,
  WorkspaceManifest,
} from "./workspaceState";
import { validateEditedDocumentIntegrity } from "./workspaceIntegrity";

type WorkspacePushProfile = WriteProfile & {
  workspaceDir: string;
  knowstrHome?: string;
};

type ChangedWorkspaceDocument = {
  document: WorkspaceManifest["documents"][number];
  currentContent: string;
  baselineContent: string;
};

function resolveKnowstrHome(profile: WorkspacePushProfile): string {
  return profile.knowstrHome ?? path.join(profile.workspaceDir, ".knowstr");
}

function basePathForDocument(
  knowstrHome: string,
  document: WorkspaceManifest["documents"][number]
): string {
  return document.base_path
    ? path.join(knowstrHome, document.base_path)
    : path.join(knowstrHome, "base", document.path);
}

async function readChangedWorkspaceDocuments(
  profile: WorkspacePushProfile,
  manifest: WorkspaceManifest
): Promise<ChangedWorkspaceDocument[]> {
  const knowstrHome = resolveKnowstrHome(profile);
  const maybeDocuments = await Promise.all(
    manifest.documents.map(async (document) => {
      const documentPath = path.join(profile.workspaceDir, document.path);
      const basePath = basePathForDocument(knowstrHome, document);
      const [currentContent, baselineContent] = await Promise.all([
        fs.readFile(documentPath, "utf8"),
        fs.readFile(basePath, "utf8"),
      ]);
      return currentContent === baselineContent
        ? undefined
        : {
            document,
            currentContent,
            baselineContent,
          };
    })
  );

  return maybeDocuments.filter(
    (document): document is ChangedWorkspaceDocument => Boolean(document)
  );
}

function buildUnsignedDocumentEventFromContent(
  pubkey: PublicKey,
  dTag: string,
  baselineContent: string,
  content: string
): {
  event: UnsignedEvent;
  deletedMarkers: string[];
} {
  const { sanitizedRoot, deletedMarkers } = validateEditedDocumentIntegrity(
    baselineContent,
    content
  );
  const builtEvent = buildDocumentEventFromMarkdownTree(pubkey, sanitizedRoot);
  return {
    event: {
      ...builtEvent.event,
      content: ensureEditableDocumentHeader(
        builtEvent.event.content,
        pubkey,
        dTag,
        { includeDeleteSection: false }
      ),
    },
    deletedMarkers,
  };
}

type ProcessedPushResult = {
  manifest: WorkspaceManifest;
  eventIds: string[];
  updatedPaths: string[];
  copiedPaths: string[];
  remainingPaths: string[];
  publishResults: Record<string, Record<string, PublishStatus>>;
};

function allRelaysFulfilled(
  publishResults: Record<string, PublishStatus>
): boolean {
  return Object.values(publishResults).every(
    (status) => status.status === "fulfilled"
  );
}

export async function pushEditedWorkspaceDocuments(
  publisher: WritePublisher,
  profile: WorkspacePushProfile,
  relayUrlsOverride?: string[]
): Promise<{
  event_ids: string[];
  relay_urls: string[];
  changed_paths: string[];
  updated_paths: string[];
  copied_paths: string[];
  remaining_paths: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  const manifest = await loadWorkspaceManifest(profile.workspaceDir);
  if (!manifest) {
    throw new Error(`Missing workspace manifest: ${profile.workspaceDir}`);
  }

  const changedDocuments = await readChangedWorkspaceDocuments(
    profile,
    manifest
  );
  if (changedDocuments.length === 0) {
    return {
      event_ids: [],
      relay_urls: [],
      changed_paths: [],
      updated_paths: [],
      copied_paths: [],
      remaining_paths: [],
      publish_results: {},
    };
  }

  const relayUrls = resolveWriteRelayUrls(profile, relayUrlsOverride);
  const secretKey = await loadWriteSecretKey(profile);
  const knowstrHome = resolveKnowstrHome(profile);

  const processed = await changedDocuments.reduce(
    async (previous, changed) => {
      const acc = await previous;
      const unsignedEvent = buildUnsignedDocumentEventFromContent(
        profile.pubkey,
        changed.document.d_tag,
        changed.baselineContent,
        changed.currentContent
      );
      const [event] = signUnsignedEvents(secretKey, [unsignedEvent.event]);
      const published = await publishSignedEvents(publisher, relayUrls, [
        event,
      ]);
      const eventPublishResults = published.publish_results[event.id] || {};

      if (!allRelaysFulfilled(eventPublishResults)) {
        return {
          ...acc,
          eventIds: [...acc.eventIds, event.id],
          remainingPaths: [...acc.remainingPaths, changed.document.path],
          publishResults: {
            ...acc.publishResults,
            [event.id]: eventPublishResults,
          },
        };
      }

      if (changed.document.author !== profile.pubkey) {
        await fs.writeFile(
          path.join(profile.workspaceDir, changed.document.path),
          changed.baselineContent,
          "utf8"
        );
      }

      const nextManifest = await applyKnowledgeEventsToWorkspace(
        profile.workspaceDir,
        knowstrHome,
        acc.manifest,
        [event as Event]
      );
      if (changed.document.author === profile.pubkey) {
        await fs.writeFile(
          basePathForDocument(knowstrHome, changed.document),
          changed.currentContent,
          "utf8"
        );
      }

      return {
        manifest: nextManifest,
        eventIds: [...acc.eventIds, event.id],
        updatedPaths:
          changed.document.author === profile.pubkey
            ? [...acc.updatedPaths, changed.document.path]
            : acc.updatedPaths,
        copiedPaths:
          changed.document.author !== profile.pubkey
            ? [...acc.copiedPaths, changed.document.path]
            : acc.copiedPaths,
        remainingPaths: acc.remainingPaths,
        publishResults: {
          ...acc.publishResults,
          [event.id]: eventPublishResults,
        },
      };
    },
    Promise.resolve<ProcessedPushResult>({
      manifest,
      eventIds: [],
      updatedPaths: [],
      copiedPaths: [],
      remainingPaths: [],
      publishResults: {},
    })
  );

  return {
    event_ids: processed.eventIds,
    relay_urls: relayUrls,
    changed_paths: changedDocuments.map(({ document }) => document.path),
    updated_paths: processed.updatedPaths,
    copied_paths: processed.copiedPaths,
    remaining_paths: processed.remainingPaths,
    publish_results: processed.publishResults,
  };
}
