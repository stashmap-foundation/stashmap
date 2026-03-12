import { SimplePool } from "nostr-tools";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { PushCliArgs } from "./types";
import {
  loadPendingWriteEntries,
  pushPendingWriteEntries,
} from "../core/pendingWrites";
import { publishEventToRelays } from "../nostrPublish";
import { getWriteRelays, relaysFromUrls, uniqueRelayUrls } from "../relayUtils";
import { WriteProfile } from "../core/writeSupport";

type PushProfile = WriteProfile & { knowstrHome?: string };
type PushPool = Pick<SimplePool, "publish" | "close">;

export function parsePushArgs(args: string[]): PushCliArgs {
  const parse = (index: number, current: PushCliArgs): PushCliArgs => {
    const arg = args[index];
    if (!arg) {
      return current;
    }

    switch (arg) {
      case "--help":
      case "-h":
        return parse(index + 1, {
          ...current,
          help: true,
        });
      case "--config":
        return parse(index + 2, {
          ...current,
          configPath: requireValue(args, index, "--config"),
        });
      case "--relay":
        return parse(index + 2, {
          ...current,
          relayUrls: [
            ...current.relayUrls,
            requireValue(args, index, "--relay"),
          ],
        });
      default:
        throw new Error(`Unknown push argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    help: false,
  });
}

export function pushHelp(): string {
  return [
    "Usage: knowstr push [--config <path>] [--relay <url> ...]",
    "",
    "Publishes queued signed events from .knowstr/pending-writes.json to relays.",
  ].join("\n");
}

async function fallbackCloseRelayUrls(
  profile: PushProfile,
  relayUrlsOverride: string[]
): Promise<string[]> {
  const pendingEntries = await loadPendingWriteEntries(profile.knowstrHome);
  const queuedRelayUrls = pendingEntries.flatMap(
    ({ relayUrls }) => relayUrls || []
  );
  return uniqueRelayUrls(
    relaysFromUrls([
      ...relayUrlsOverride,
      ...queuedRelayUrls,
      ...getWriteRelays(profile.relays).map(({ url }) => url),
    ])
  );
}

export async function pushPendingWritesWithPool(
  pool: PushPool,
  profile: PushProfile,
  relayUrlsOverride: string[]
): Promise<Awaited<ReturnType<typeof pushPendingWriteEntries>>> {
  try {
    const result = await pushPendingWriteEntries(
      {
        publishEvent: (relayUrls, event) =>
          publishEventToRelays(pool, event, relayUrls),
      },
      profile,
      relayUrlsOverride
    );
    pool.close(result.relay_urls);
    return result;
  } catch (error) {
    pool.close(await fallbackCloseRelayUrls(profile, relayUrlsOverride));
    throw error;
  }
}

export async function runPushCommand(
  args: string[]
): Promise<
  | { help: true; text: string }
  | Awaited<ReturnType<typeof pushPendingWriteEntries>>
> {
  const parsed = parsePushArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: pushHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const pool = new SimplePool();
  return pushPendingWritesWithPool(pool, profile, parsed.relayUrls);
}
