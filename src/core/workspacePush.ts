import fs from "fs/promises";
import path from "path";
import {
  buildDocumentEventFromMarkdownTree,
  requireSingleRootMarkdownTree,
} from "../standaloneDocumentEvent";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "../markdownTree";
import { extractMarkdownImportPayload } from "../markdownImport";
import {
  publishSignedEvents,
  resolveWriteRelayUrls,
  signUnsignedEvents,
  loadWriteSecretKey,
  WriteProfile,
  WritePublisher,
} from "./writeSupport";
import {
  DOCUMENTS_DIR,
  extractDTagFromHeader,
  readBaselineContent,
  removeWorkspaceFileIfExists,
  stripFrontMatter,
  writeDocumentFiles,
} from "./workspaceState";
import { validateEditedDocumentIntegrity } from "./workspaceIntegrity";

type WorkspacePushProfile = WriteProfile & {
  workspaceDir: string;
  knowstrHome?: string;
};

type ChangedDocument = {
  filePath: string;
  author: PublicKey;
  dTag: string | undefined;
  currentContent: string;
  baselineContent: string;
};

function resolveKnowstrHome(profile: WorkspacePushProfile): string {
  return profile.knowstrHome ?? path.join(profile.workspaceDir, ".knowstr");
}

async function scanWorkspaceDocuments(
  workspaceDir: string,
  knowstrHome: string,
  author: PublicKey
): Promise<ChangedDocument[]> {
  const authorPath = path.join(workspaceDir, DOCUMENTS_DIR, author);
  try {
    await fs.access(authorPath);
  } catch {
    return [];
  }

  const files = await fs.readdir(authorPath);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const docs = await Promise.all(
    mdFiles.map(async (file) => {
      const filePath = path.join(authorPath, file);
      const currentContent = await fs.readFile(filePath, "utf8");
      const dTag = extractDTagFromHeader(currentContent);
      if (!dTag) {
        return {
          filePath,
          author,
          dTag: undefined,
          currentContent,
          baselineContent: "",
        };
      }

      const baseline = await readBaselineContent(knowstrHome, author, dTag);
      if (baseline && baseline === currentContent) {
        return undefined;
      }
      if (!baseline) {
        return {
          filePath,
          author,
          dTag,
          currentContent,
          baselineContent: "",
        };
      }
      return {
        filePath,
        author,
        dTag,
        currentContent,
        baselineContent: baseline,
      };
    })
  );

  return docs.filter((doc): doc is ChangedDocument => doc !== undefined);
}

function hasAnyUuidMarker(node: MarkdownTreeNode): boolean {
  if (node.uuid) {
    return true;
  }
  return node.children.some((child) => hasAnyUuidMarker(child));
}

function buildNewDocumentTree(content: string): MarkdownTreeNode {
  const { body, frontMatter, metadata } = extractMarkdownImportPayload(content);
  const roots = parseMarkdownHierarchy(body).filter((root) => !root.hidden);
  const singleRoot =
    roots.length === 1 && (!metadata.title || roots[0]?.blockKind === "heading")
      ? roots[0]
      : undefined;
  const titledRoot = metadata.title
    ? {
        text: metadata.title,
        children: roots,
        ...(frontMatter ? { frontMatter } : {}),
      }
    : undefined;
  const rootTree =
    singleRoot ||
    titledRoot ||
    requireSingleRootMarkdownTree(
      body,
      "New document must contain exactly one top-level root"
    );
  if (!rootTree) {
    throw new Error("New document must contain exactly one top-level root");
  }
  const rootTreeWithFrontMatter = frontMatter
    ? { ...rootTree, frontMatter }
    : rootTree;
  if (hasAnyUuidMarker(rootTreeWithFrontMatter)) {
    throw new Error(
      "New documents must not contain ks:id markers — they are generated on push"
    );
  }
  return rootTreeWithFrontMatter;
}

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
  remaining_paths: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  const knowstrHome = resolveKnowstrHome(profile);
  const changedDocuments = await scanWorkspaceDocuments(
    profile.workspaceDir,
    knowstrHome,
    profile.pubkey
  );

  if (changedDocuments.length === 0) {
    return {
      event_ids: [],
      relay_urls: [],
      changed_paths: [],
      updated_paths: [],
      remaining_paths: [],
      publish_results: {},
    };
  }

  const relayUrls = resolveWriteRelayUrls(profile, relayUrlsOverride);
  const secretKey = await loadWriteSecretKey(profile);

  const processed = await changedDocuments.reduce(
    async (previous, changed) => {
      const acc = await previous;
      const { frontMatter } = extractMarkdownImportPayload(
        changed.currentContent
      );
      const rootTree =
        changed.baselineContent && changed.dTag
          ? {
              ...validateEditedDocumentIntegrity(
                stripFrontMatter(changed.baselineContent),
                stripFrontMatter(changed.currentContent)
              ).sanitizedRoot,
              ...(frontMatter ? { frontMatter } : {}),
            }
          : buildNewDocumentTree(changed.currentContent);
      const builtEvent = buildDocumentEventFromMarkdownTree(
        profile.pubkey,
        rootTree
      );
      const unsignedEvent = builtEvent.event;
      const eventDTag =
        changed.dTag || unsignedEvent.tags.find(([k]) => k === "d")?.[1];
      if (!eventDTag) {
        return acc;
      }
      const [event] = signUnsignedEvents(secretKey, [unsignedEvent]);
      const published = await publishSignedEvents(publisher, relayUrls, [
        event,
      ]);
      const eventPublishResults = published.publish_results[event.id] || {};

      if (!allRelaysFulfilled(eventPublishResults)) {
        return {
          ...acc,
          eventIds: [...acc.eventIds, event.id],
          remainingPaths: [...acc.remainingPaths, changed.filePath],
          publishResults: {
            ...acc.publishResults,
            [event.id]: eventPublishResults,
          },
        };
      }

      const written = await writeDocumentFiles(
        profile.workspaceDir,
        knowstrHome,
        event
      );
      if (written && written.workspacePath !== changed.filePath) {
        await removeWorkspaceFileIfExists(changed.filePath);
      }

      return {
        eventIds: [...acc.eventIds, event.id],
        updatedPaths: [
          ...acc.updatedPaths,
          written?.workspacePath ?? changed.filePath,
        ],
        remainingPaths: acc.remainingPaths,
        publishResults: {
          ...acc.publishResults,
          [event.id]: eventPublishResults,
        },
      };
    },
    Promise.resolve<{
      eventIds: string[];
      updatedPaths: string[];
      remainingPaths: string[];
      publishResults: Record<string, Record<string, PublishStatus>>;
    }>({
      eventIds: [],
      updatedPaths: [],
      remainingPaths: [],
      publishResults: {},
    })
  );

  return {
    event_ids: processed.eventIds,
    relay_urls: relayUrls,
    changed_paths: changedDocuments.map(({ filePath }) => filePath),
    updated_paths: processed.updatedPaths,
    remaining_paths: processed.remainingPaths,
    publish_results: processed.publishResults,
  };
}
