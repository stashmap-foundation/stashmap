import { SimplePool } from "nostr-tools";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { SyncPullCliArgs } from "./types";
import { pullSyncWorkspace, SyncPullManifest } from "../core/syncPull";

export function parseSyncPullArgs(args: string[]): SyncPullCliArgs {
  const parse = (index: number, current: SyncPullCliArgs): SyncPullCliArgs => {
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
      case "--out":
        return parse(index + 2, {
          ...current,
          outDir: requireValue(args, index, "--out"),
        });
      case "--relay":
        return parse(index + 2, {
          ...current,
          relayUrls: [
            ...current.relayUrls,
            requireValue(args, index, "--relay"),
          ],
        });
      case "--max-wait": {
        const value = requireValue(args, index, "--max-wait");
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
          throw new Error("--max-wait must be a positive number");
        }
        return parse(index + 2, {
          ...current,
          maxWaitMs: parsedValue,
        });
      }
      default:
        throw new Error(`Unknown sync pull argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    help: false,
  });
}

export function syncPullHelp(): string {
  return [
    "Usage: knowstr sync pull [--config <path>] [--out <path>] [--relay <url> ...]",
    "",
    "Reads the Knowstr graph from configured relays and exports a local workspace.",
  ].join("\n");
}

export async function runSyncPullCommand(
  args: string[]
): Promise<{ help: true; text: string } | SyncPullManifest> {
  const parsed = parseSyncPullArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: syncPullHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const pool = new SimplePool();

  return pullSyncWorkspace(
    {
      querySync: (relayUrls, filter, params) =>
        pool.querySync(relayUrls, filter, params),
      close: (relayUrls) => pool.close(relayUrls),
    },
    profile,
    {
      outDir: parsed.outDir,
      relayUrls: parsed.relayUrls,
      maxWaitMs: parsed.maxWaitMs,
    }
  );
}
