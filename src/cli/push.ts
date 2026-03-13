import { SimplePool } from "nostr-tools";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { PushCliArgs } from "./types";
import { publishEventToRelays } from "../nostrPublish";
import { pushEditedWorkspaceDocuments } from "../core/workspacePush";

type PushProfile = ReturnType<typeof loadCliProfile>;
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
    "Publishes locally edited workspace documents to relays.",
  ].join("\n");
}

export async function pushPendingWritesWithPool(
  pool: PushPool,
  profile: PushProfile,
  relayUrlsOverride: string[]
): Promise<Awaited<ReturnType<typeof pushEditedWorkspaceDocuments>>> {
  try {
    const result = await pushEditedWorkspaceDocuments(
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
    pool.close(relayUrlsOverride);
    throw error;
  }
}

export async function runPushCommand(
  args: string[]
): Promise<
  | { help: true; text: string }
  | Awaited<ReturnType<typeof pushEditedWorkspaceDocuments>>
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
