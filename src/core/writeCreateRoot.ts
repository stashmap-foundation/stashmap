import fs from "fs/promises";
import path from "path";
import {
  buildImportedMarkdownDocumentEvent,
  buildSingleRootMarkdownDocumentEvent,
  buildStandaloneRootDocumentEvent,
} from "../standaloneDocumentEvent";
import {
  loadWriteSecretKey,
  signUnsignedEvents,
  WriteProfile,
} from "./writeSupport";
import {
  applyKnowledgeEventsToWorkspace,
  loadOrCreateWorkspaceManifest,
} from "./workspaceState";
import { enqueuePendingWriteEntries } from "./pendingWrites";
import { relaysFromUrls, uniqueRelayUrls } from "../relayUtils";

export type WriteCreateRootOptions = {
  title?: string;
  filePath?: string;
  markdownText?: string;
  relayUrls?: string[];
  includeMarkdown?: boolean;
};

export type WriteCreateRootProfile = WriteProfile & {
  workspaceDir?: string;
  knowstrHome?: string;
};

export type { WriteProfile } from "./writeSupport";

export async function writeCreateRoot(
  profile: WriteCreateRootProfile,
  options: WriteCreateRootOptions
): Promise<{
  event_id: string;
  relation_id: LongID;
  root_uuid: string;
  relay_urls: string[];
  pending_event_ids: string[];
  pending_count: number;
  markdown?: string;
}> {
  const hasTitle = options.title !== undefined;
  const hasFilePath = options.filePath !== undefined;
  const hasMarkdownText = options.markdownText !== undefined;
  if ([hasTitle, hasFilePath, hasMarkdownText].filter(Boolean).length !== 1) {
    throw new Error("Provide exactly one of --title, --file, or --stdin");
  }

  const secretKey = await loadWriteSecretKey(profile);
  const explicitRelayUrls =
    options.relayUrls && options.relayUrls.length > 0
      ? uniqueRelayUrls(relaysFromUrls(options.relayUrls))
      : undefined;
  const draft = (() => {
    if (options.filePath) {
      return fs
        .readFile(path.resolve(options.filePath), "utf8")
        .then((markdown) =>
          buildImportedMarkdownDocumentEvent(profile.pubkey, {
            name: path.basename(options.filePath as string),
            markdown,
          })
        );
    }
    if (options.markdownText !== undefined) {
      return Promise.resolve(
        buildSingleRootMarkdownDocumentEvent(
          profile.pubkey,
          options.markdownText
        )
      );
    }
    const title = (options.title || "").trim();
    if (title.length === 0) {
      throw new Error("--title must not be empty");
    }
    return Promise.resolve(
      buildStandaloneRootDocumentEvent(profile.pubkey, title)
    );
  })();
  const resolvedDraft = await draft;
  const signedEvents = signUnsignedEvents(secretKey, [resolvedDraft.event]);
  if (profile.workspaceDir) {
    const workspaceManifest = await loadOrCreateWorkspaceManifest(
      profile.workspaceDir,
      profile.pubkey
    );
    await applyKnowledgeEventsToWorkspace(
      profile.workspaceDir,
      profile.knowstrHome,
      workspaceManifest,
      signedEvents
    );
  }
  const pendingEntries = await enqueuePendingWriteEntries(
    profile.knowstrHome,
    signedEvents.map((event) => ({
      event,
      ...(explicitRelayUrls ? { relayUrls: explicitRelayUrls } : {}),
    }))
  );
  const eventId = signedEvents[0]?.id;

  return {
    event_id: eventId || "",
    relation_id: resolvedDraft.relationID,
    root_uuid: resolvedDraft.rootUuid,
    relay_urls: explicitRelayUrls || [],
    pending_event_ids: pendingEntries.map(({ event }) => event.id),
    pending_count: pendingEntries.length,
    ...(options.includeMarkdown
      ? { markdown: resolvedDraft.event.content }
      : {}),
  };
}
