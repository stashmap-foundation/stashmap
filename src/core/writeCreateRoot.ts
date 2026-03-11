import fs from "fs/promises";
import path from "path";
import { Event, getPublicKey, finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { convertInputToPrivateKey } from "../nostrKey";
import { getWriteRelays, relaysFromUrls, uniqueRelayUrls } from "../relayUtils";
import {
  buildImportedMarkdownDocumentEvent,
  buildSingleRootMarkdownDocumentEvent,
  buildStandaloneRootDocumentEvent,
} from "../standaloneDocumentEvent";

export type WriteProfile = {
  pubkey: PublicKey;
  relays: Relays;
  nsecFile?: string;
};

export type WriteCreateRootOptions = {
  title?: string;
  filePath?: string;
  markdownText?: string;
  relayUrls?: string[];
  includeMarkdown?: boolean;
};

export type WritePublisher = {
  publishEvent: (
    relayUrls: string[],
    event: Event
  ) => Promise<PublishResultsOfEvent>;
};

function resolveWriteRelayUrls(
  profile: WriteProfile,
  relayUrls: string[] | undefined
): string[] {
  const explicitRelays = relaysFromUrls(relayUrls || []);
  if (explicitRelays.length > 0) {
    return uniqueRelayUrls(explicitRelays);
  }

  const configuredRelayUrls = uniqueRelayUrls(getWriteRelays(profile.relays));
  if (configuredRelayUrls.length === 0) {
    throw new Error(
      "No write relays configured. Provide --relay or write-enabled relays in .knowstr/profile.json"
    );
  }
  return configuredRelayUrls;
}

async function loadPrivateKeyHex(nsecFile: string): Promise<string> {
  const raw = await fs.readFile(nsecFile, "utf8");
  const privateKey = convertInputToPrivateKey(raw);
  if (!privateKey) {
    throw new Error(`Invalid private key in ${nsecFile}`);
  }
  return privateKey;
}

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
  if (!profile.nsecFile) {
    throw new Error("profile.json must include nsec_file for write commands");
  }

  const privateKeyHex = await loadPrivateKeyHex(profile.nsecFile);
  const secretKey = hexToBytes(privateKeyHex);
  const derivedPubkey = getPublicKey(secretKey) as PublicKey;
  if (derivedPubkey !== profile.pubkey) {
    throw new Error("nsec_file does not match profile pubkey");
  }

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
  const event = finalizeEvent(resolvedDraft.event, secretKey);
  const publishResult = await publisher.publishEvent(relayUrls, event);

  return {
    event_id: event.id,
    relation_id: resolvedDraft.relationID,
    root_uuid: resolvedDraft.rootUuid,
    semantic_id: resolvedDraft.semanticID,
    relay_urls: relayUrls,
    publish_results: publishResult.results.toObject(),
    ...(options.includeMarkdown
      ? { markdown: resolvedDraft.event.content }
      : {}),
  };
}
