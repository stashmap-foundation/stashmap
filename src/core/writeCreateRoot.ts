import fs from "fs/promises";
import path from "path";
import {
  buildImportedMarkdownDocumentEvent,
  buildSingleRootMarkdownDocumentEvent,
  buildStandaloneRootDocumentEvent,
} from "../standaloneDocumentEvent";
import {
  loadWriteSecretKey,
  publishUnsignedEvents,
  resolveWriteRelayUrls,
  WriteProfile,
  WritePublisher,
} from "./writeSupport";

export type WriteCreateRootOptions = {
  title?: string;
  filePath?: string;
  markdownText?: string;
  relayUrls?: string[];
  includeMarkdown?: boolean;
};

export type { WriteProfile, WritePublisher } from "./writeSupport";

export async function writeCreateRoot(
  publisher: WritePublisher,
  profile: WriteProfile,
  options: WriteCreateRootOptions
): Promise<{
  event_id: string;
  relation_id: LongID;
  root_uuid: string;
  semantic_id: ID;
  relay_urls: string[];
  publish_results: Record<string, PublishStatus>;
  markdown?: string;
}> {
  const hasTitle = options.title !== undefined;
  const hasFilePath = options.filePath !== undefined;
  const hasMarkdownText = options.markdownText !== undefined;
  if ([hasTitle, hasFilePath, hasMarkdownText].filter(Boolean).length !== 1) {
    throw new Error("Provide exactly one of --title, --file, or --stdin");
  }

  const secretKey = await loadWriteSecretKey(profile);
  const relayUrls = resolveWriteRelayUrls(profile, options.relayUrls);
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
  const published = await publishUnsignedEvents(
    publisher,
    secretKey,
    relayUrls,
    [resolvedDraft.event]
  );

  return {
    event_id: published.event_ids[0],
    relation_id: resolvedDraft.relationID,
    root_uuid: resolvedDraft.rootUuid,
    semantic_id: resolvedDraft.semanticID,
    relay_urls: published.relay_urls,
    publish_results: published.publish_results[published.event_ids[0]] || {},
    ...(options.includeMarkdown
      ? { markdown: resolvedDraft.event.content }
      : {}),
  };
}
